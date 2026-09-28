package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"aura-payment-orchestrator/worker/internal/database"
	"aura-payment-orchestrator/worker/internal/metrics"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

const (
	streamName                = "payment_events"
	consumerGroup             = "payment_workers"
	consumerName              = "worker-1"
	metricsResetGenerationKey = "paymentops:metrics_reset_generation"
	metricsResetAckKey        = "paymentops:metrics_reset_ack"

	// Demo retry delay.
	// In production this would normally use exponential backoff.
	retryDelay = 10 * time.Second

	// Pending Redis messages are reclaimed after being idle
	// for at least this long.
	pendingMessageMinIdle = 10 * time.Second
)

func main() {
	// ---------------------------------------------------------
	// Prometheus metrics
	// ---------------------------------------------------------

	metrics.Init()

	go func() {
		port := os.Getenv("PORT")
		if port == "" {
			port = "9090"
		}

		mux := http.NewServeMux()
		mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			promhttp.Handler().ServeHTTP(w, r)
		})

		log.Printf("Metrics server listening on :%s", port)

		if err := http.ListenAndServe(":"+port, mux); err != nil {
			log.Printf("Metrics server stopped: %v", err)
		}
	}()

	ctx := context.Background()

	// ---------------------------------------------------------
	// Redis
	// ---------------------------------------------------------

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("invalid redis URL: %v", err)
	}
	rdb := redis.NewClient(redisOptions)

	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("redis connection failed: %v", err)
	}

	log.Println("Connected to Redis")

	// ---------------------------------------------------------
	// PostgreSQL
	// ---------------------------------------------------------

	db, err := database.Connect(ctx)
	if err != nil {
		log.Fatalf("postgres connection failed: %v", err)
	}

	defer db.Close()

	log.Println("Connected to PostgreSQL")

	// ---------------------------------------------------------
	// Redis Consumer Group
	// ---------------------------------------------------------

	err = rdb.XGroupCreateMkStream(
		ctx,
		streamName,
		consumerGroup,
		"0",
	).Err()

	if err != nil &&
		err.Error() != "BUSYGROUP Consumer Group name already exists" {
		log.Fatalf("failed to create consumer group: %v", err)
	}

	metricsResetGeneration, err := rdb.Get(ctx, metricsResetGenerationKey).Int64()
	if err != nil && err != redis.Nil {
		log.Fatalf("failed to read metrics reset generation: %v", err)
	}
	if err := rdb.Set(ctx, metricsResetAckKey, metricsResetGeneration, 0).Err(); err != nil {
		log.Fatalf("failed to initialize metrics reset acknowledgement: %v", err)
	}

	log.Printf(
		"Listening to stream=%s group=%s consumer=%s",
		streamName,
		consumerGroup,
		consumerName,
	)

	// Recover messages that were previously delivered but
	// never acknowledged.
	recoverPendingMessages(ctx, rdb, db)

	for {
		metricsResetGeneration = resetMetricsIfRequested(
			ctx,
			rdb,
			metricsResetGeneration,
		)

		// Recover any pending messages that have become
		// reclaimable.
		recoverPendingMessages(ctx, rdb, db)

		// Process scheduled database retries.
		processDueRetries(ctx, db)

		// Wait for new Redis messages.
		streams, err := rdb.XReadGroup(
			ctx,
			&redis.XReadGroupArgs{
				Group:    consumerGroup,
				Consumer: consumerName,
				Streams:  []string{streamName, ">"},
				Count:    1,
				Block:    5 * time.Second,
			},
		).Result()

		if err == redis.Nil {
			continue
		}

		if err != nil {
			log.Printf("failed to read stream: %v", err)
			time.Sleep(time.Second)
			continue
		}

		for _, stream := range streams {
			for _, message := range stream.Messages {
				metricsResetGeneration = resetMetricsIfRequested(
					ctx,
					rdb,
					metricsResetGeneration,
				)
				processMessage(ctx, rdb, db, message)
			}
		}
	}
}

func resetMetricsIfRequested(
	ctx context.Context,
	rdb *redis.Client,
	currentGeneration int64,
) int64 {
	generation, err := rdb.Get(ctx, metricsResetGenerationKey).Int64()
	if err != nil || generation <= currentGeneration {
		return currentGeneration
	}

	metrics.Reset()
	if err := rdb.Set(ctx, metricsResetAckKey, generation, 0).Err(); err != nil {
		log.Printf("failed to acknowledge metrics reset: %v", err)
		return currentGeneration
	}
	log.Printf("Reset worker metrics at generation %d", generation)
	return generation
}

// ============================================================
// Redis Pending Message Recovery
// ============================================================

func recoverPendingMessages(
	ctx context.Context,
	rdb *redis.Client,
	db *pgxpool.Pool,
) {
	startID := "0-0"

	for {
		messages, nextStartID, err := rdb.XAutoClaim(
			ctx,
			&redis.XAutoClaimArgs{
				Stream:   streamName,
				Group:    consumerGroup,
				Consumer: consumerName,
				MinIdle:  pendingMessageMinIdle,
				Start:    startID,
				Count:    10,
			},
		).Result()

		if err != nil {
			log.Printf("failed to recover pending messages: %v", err)
			return
		}

		if len(messages) == 0 {
			return
		}

		log.Printf(
			"Recovered %d pending message(s)",
			len(messages),
		)

		for _, message := range messages {
			log.Printf(
				"Reprocessing recovered message: %s",
				message.ID,
			)

			processMessage(ctx, rdb, db, message)
		}

		if nextStartID == "0-0" {
			return
		}

		startID = nextStartID
	}
}

// ============================================================
// Redis Message Processing
// ============================================================

func processMessage(
	ctx context.Context,
	rdb *redis.Client,
	db *pgxpool.Pool,
	message redis.XMessage,
) {
	log.Println("========================================")
	log.Printf("Received message: %s", message.ID)

	for key, value := range message.Values {
		fmt.Printf("%s: %v\n", key, value)
	}

	log.Println("Processing payment...")

	if err := processPayment(ctx, db, message); err != nil {
		log.Printf("payment processing failed: %v", err)
		return
	}

	// The payment event was successfully handled by the worker.
	metrics.PaymentEventsProcessed.WithLabelValues("current").Inc()

	log.Printf(
		"Payment processed: %v",
		message.Values["payment_id"],
	)

	// ACK only after PostgreSQL has successfully committed.
	if err := rdb.XAck(
		ctx,
		streamName,
		consumerGroup,
		message.ID,
	).Err(); err != nil {
		log.Printf(
			"failed to ACK message %s: %v",
			message.ID,
			err,
		)

		return
	}

	log.Printf("Message ACKed: %s", message.ID)
	log.Println("========================================")
}

// ============================================================
// Payment Processing
// ============================================================

func processPayment(
	ctx context.Context,
	db *pgxpool.Pool,
	message redis.XMessage,
) error {
	paymentID := fmt.Sprintf(
		"%v",
		message.Values["payment_id"],
	)

	mandateID := fmt.Sprintf(
		"%v",
		message.Values["mandate_id"],
	)

	eventID := fmt.Sprintf(
		"%v",
		message.Values["event_id"],
	)

	providerStatus := fmt.Sprintf(
		"%v",
		message.Values["provider_status"],
	)

	// ---------------------------------------------------------
	// Start transaction
	// ---------------------------------------------------------

	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf(
			"failed to begin transaction: %w",
			err,
		)
	}

	defer tx.Rollback(ctx)

	// ---------------------------------------------------------
	// Lock mandate
	// ---------------------------------------------------------

	var userID string
	var amount string
	var currency string
	var status string

	err = tx.QueryRow(
		ctx,
		`
		SELECT user_id, amount, currency, status
		FROM mandates
		WHERE id = $1
		FOR UPDATE
		`,
		mandateID,
	).Scan(
		&userID,
		&amount,
		&currency,
		&status,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to load mandate: %w",
			err,
		)
	}

	if status != "ACTIVE" && status != "CREATED" {
		return fmt.Errorf(
			"mandate is not chargeable: %s",
			status,
		)
	}

	// ---------------------------------------------------------
	// Business-level idempotency
	// ---------------------------------------------------------

	var existingLedgerEntryID string

	err = tx.QueryRow(
		ctx,
		`
		SELECT id
		FROM ledger_entries
		WHERE payment_id = $1
		  AND entry_type = 'GOLD_CREDIT'
		LIMIT 1
		`,
		paymentID,
	).Scan(&existingLedgerEntryID)

	if err == nil {
		// Payment already produced a financial effect.

		_, err = tx.Exec(
			ctx,
			`
			UPDATE payment_events
			SET status = 'IGNORED',
			    processed_at = NOW()
			WHERE event_id = $1
			`,
			eventID,
		)

		if err != nil {
			return fmt.Errorf(
				"failed to mark duplicate payment event: %w",
				err,
			)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf(
				"failed to commit duplicate payment event: %w",
				err,
			)
		}

		log.Printf(
			"Payment already processed: payment_id=%s, event_id=%s. "+
				"Ignoring duplicate financial effect.",
			paymentID,
			eventID,
		)

		return nil
	}

	if err != pgx.ErrNoRows {
		return fmt.Errorf(
			"failed to check existing ledger entry: %w",
			err,
		)
	}

	// ---------------------------------------------------------
	// Handle failed provider payment
	// ---------------------------------------------------------

	if providerStatus == "FAILED" {
		paymentAttemptID := uuid.New()

		_, err = tx.Exec(
			ctx,
			`
			INSERT INTO payment_attempts (
				id,
				mandate_id,
				payment_id,
				attempt_number,
				amount,
				currency,
				status,
				error_code,
				error_message,
				next_retry_at
			)
			VALUES (
				$1,
				$2,
				$3,
				(
					SELECT COALESCE(
						MAX(attempt_number),
						0
					) + 1
					FROM payment_attempts
					WHERE payment_id = $3::varchar
				),
				$4,
				$5,
				'FAILED',
				'MOCK_PAYMENT_FAILED',
				'Mock provider returned FAILED',
				NOW() + $6
			)
			`,
			paymentAttemptID,
			mandateID,
			paymentID,
			amount,
			currency,
			retryDelay,
		)

		if err != nil {
			return fmt.Errorf(
				"failed to create failed payment attempt: %w",
				err,
			)
		}

		// The webhook itself has been successfully handled.
		// The financial payment will be retried asynchronously.
		_, err = tx.Exec(
			ctx,
			`
			UPDATE payment_events
			SET status = 'PROCESSED',
			    processed_at = NOW()
			WHERE event_id = $1
			`,
			eventID,
		)

		if err != nil {
			return fmt.Errorf(
				"failed to update failed payment event: %w",
				err,
			)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf(
				"failed to commit failed payment attempt: %w",
				err,
			)
		}

		// The failed attempt is now durably stored.
		metrics.PaymentFailures.WithLabelValues("current").Inc()

		log.Printf(
			"Payment failed: payment_id=%s. "+
				"Retry scheduled in %s.",
			paymentID,
			retryDelay,
		)

		return nil
	}

	// ---------------------------------------------------------
	// Successful payment
	// ---------------------------------------------------------

	paymentAttemptID := uuid.New()
	ledgerEntryID := uuid.New()

	// Create successful payment attempt.
	_, err = tx.Exec(
		ctx,
		`
		INSERT INTO payment_attempts (
			id,
			mandate_id,
			payment_id,
			attempt_number,
			amount,
			currency,
			status
		)
		VALUES (
			$1,
			$2,
			$3,
			(
				SELECT COALESCE(
					MAX(attempt_number),
					0
				) + 1
				FROM payment_attempts
				WHERE payment_id = $3::varchar
			),
			$4,
			$5,
			'SUCCESS'
		)
		`,
		paymentAttemptID,
		mandateID,
		paymentID,
		amount,
		currency,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to create payment attempt: %w",
			err,
		)
	}

	// Create the financial ledger entry.
	_, err = tx.Exec(
		ctx,
		`
		INSERT INTO ledger_entries (
			id,
			user_id,
			payment_id,
			asset,
			quantity,
			entry_type,
			reference_id
		)
		VALUES (
			$1,
			$2,
			$3,
			'GOLD',
			$4,
			'GOLD_CREDIT',
			$3
		)
		`,
		ledgerEntryID,
		userID,
		paymentID,
		amount,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to create ledger entry: %w",
			err,
		)
	}

	// Mark webhook event as processed.
	_, err = tx.Exec(
		ctx,
		`
		UPDATE payment_events
		SET status = 'PROCESSED',
		    processed_at = NOW()
		WHERE event_id = $1
		`,
		eventID,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to update payment event: %w",
			err,
		)
	}

	// Commit:
	//
	// payment attempt
	// +
	// ledger entry
	// +
	// event status
	//
	// atomically.
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf(
			"failed to commit payment transaction: %w",
			err,
		)
	}

	// Only increment after the financial transaction commits.
	metrics.LedgerEntriesCreated.WithLabelValues("current").Inc()

	return nil
}

// ============================================================
// Persistent Retry Processing
// ============================================================

func processDueRetries(
	ctx context.Context,
	db *pgxpool.Pool,
) {
	rows, err := db.Query(
		ctx,
		`
		SELECT
			id,
			mandate_id,
			payment_id,
			attempt_number,
			amount,
			currency
		FROM payment_attempts
		WHERE status = 'FAILED'
		  AND next_retry_at IS NOT NULL
		  AND next_retry_at <= NOW()
		ORDER BY next_retry_at
		LIMIT 10
		`,
	)

	if err != nil {
		log.Printf(
			"failed to query due retries: %v",
			err,
		)

		return
	}

	defer rows.Close()

	for rows.Next() {
		var (
			attemptID     uuid.UUID
			mandateID     uuid.UUID
			paymentID     string
			attemptNumber int
			amount        string
			currency      string
		)

		if err := rows.Scan(
			&attemptID,
			&mandateID,
			&paymentID,
			&attemptNumber,
			&amount,
			&currency,
		); err != nil {
			log.Printf(
				"failed to scan retry: %v",
				err,
			)

			continue
		}

		if err := executeRetry(
			ctx,
			db,
			attemptID,
			mandateID,
			paymentID,
			attemptNumber,
			amount,
			currency,
		); err != nil {
			log.Printf(
				"retry failed: payment_id=%s error=%v",
				paymentID,
				err,
			)
		}
	}

	if err := rows.Err(); err != nil {
		log.Printf(
			"retry query iteration failed: %v",
			err,
		)
	}
}

// ============================================================
// Execute Retry
// ============================================================

func executeRetry(
	ctx context.Context,
	db *pgxpool.Pool,
	previousAttemptID uuid.UUID,
	mandateID uuid.UUID,
	paymentID string,
	previousAttemptNumber int,
	amount string,
	currency string,
) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf(
			"failed to begin retry transaction: %w",
			err,
		)
	}

	defer tx.Rollback(ctx)

	// Lock the mandate so two workers cannot process the
	// same recurring payment concurrently.
	var userID string
	var mandateStatus string

	err = tx.QueryRow(
		ctx,
		`
		SELECT user_id, status
		FROM mandates
		WHERE id = $1
		FOR UPDATE
		`,
		mandateID,
	).Scan(
		&userID,
		&mandateStatus,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to load mandate for retry: %w",
			err,
		)
	}

	if mandateStatus != "ACTIVE" &&
		mandateStatus != "CREATED" {
		return fmt.Errorf(
			"mandate is not chargeable for retry: %s",
			mandateStatus,
		)
	}

	// Double-check financial idempotency.
	var existingLedgerEntryID string

	err = tx.QueryRow(
		ctx,
		`
		SELECT id
		FROM ledger_entries
		WHERE payment_id = $1
		  AND entry_type = 'GOLD_CREDIT'
		LIMIT 1
		`,
		paymentID,
	).Scan(&existingLedgerEntryID)

	if err == nil {
		// Another process already succeeded.
		//
		// Clear the retry so we don't keep attempting it.
		_, err = tx.Exec(
			ctx,
			`
			UPDATE payment_attempts
			SET next_retry_at = NULL,
			    updated_at = NOW()
			WHERE id = $1
			`,
			previousAttemptID,
		)

		if err != nil {
			return fmt.Errorf(
				"failed to clear duplicate retry: %w",
				err,
			)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf(
				"failed to commit duplicate retry cleanup: %w",
				err,
			)
		}

		log.Printf(
			"Retry skipped: payment_id=%s already has a ledger entry",
			paymentID,
		)

		return nil
	}

	if err != pgx.ErrNoRows {
		return fmt.Errorf(
			"failed to check retry ledger: %w",
			err,
		)
	}

	// ---------------------------------------------------------
	// Mock provider
	// ---------------------------------------------------------
	//
	// For this MVP we assume the retry succeeds.
	// In production this would call the actual payment provider.

	log.Printf(
		"Retrying payment_id=%s, previous_attempt=%d",
		paymentID,
		previousAttemptNumber,
	)

	newAttemptID := uuid.New()
	ledgerEntryID := uuid.New()

	// Create successful retry attempt.
	_, err = tx.Exec(
		ctx,
		`
		INSERT INTO payment_attempts (
			id,
			mandate_id,
			payment_id,
			attempt_number,
			amount,
			currency,
			status,
			provider_reference
		)
		VALUES (
			$1,
			$2,
			$3,
			$4,
			$5,
			$6,
			'SUCCESS',
			$7
		)
		`,
		newAttemptID,
		mandateID,
		paymentID,
		previousAttemptNumber+1,
		amount,
		currency,
		fmt.Sprintf("mock-retry-%s", newAttemptID),
	)

	if err != nil {
		return fmt.Errorf(
			"failed to create retry attempt: %w",
			err,
		)
	}

	// Create the only financial effect.
	_, err = tx.Exec(
		ctx,
		`
		INSERT INTO ledger_entries (
			id,
			user_id,
			payment_id,
			asset,
			quantity,
			entry_type,
			reference_id
		)
		VALUES (
			$1,
			$2,
			$3,
			'GOLD',
			$4,
			'GOLD_CREDIT',
			$3
		)
		`,
		ledgerEntryID,
		userID,
		paymentID,
		amount,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to create retry ledger entry: %w",
			err,
		)
	}

	// Mark the previous failed attempt as no longer scheduled.
	_, err = tx.Exec(
		ctx,
		`
		UPDATE payment_attempts
		SET next_retry_at = NULL,
		    updated_at = NOW()
		WHERE id = $1
		`,
		previousAttemptID,
	)

	if err != nil {
		return fmt.Errorf(
			"failed to clear retry schedule: %w",
			err,
		)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf(
			"failed to commit retry transaction: %w",
			err,
		)
	}

	// Only count the retry after the retry transaction commits.
	metrics.PaymentRetries.WithLabelValues("current").Inc()
	metrics.LedgerEntriesCreated.WithLabelValues("current").Inc()

	log.Printf(
		"Retry successful: payment_id=%s attempt=%d",
		paymentID,
		previousAttemptNumber+1,
	)

	return nil
}
