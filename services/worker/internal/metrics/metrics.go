package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	PaymentEventsProcessed = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_events_processed_total",
			Help: "Total number of payment events processed by the worker.",
		},
	)

	PaymentFailures = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_failures_total",
			Help: "Total number of payment attempts that failed.",
		},
	)

	PaymentRetries = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_retries_total",
			Help: "Total number of payment retry attempts executed.",
		},
	)

	LedgerEntriesCreated = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_ledger_entries_created_total",
			Help: "Total number of successful payment ledger entries created.",
		},
	)
)

func Init() {
	prometheus.MustRegister(PaymentEventsProcessed)
	prometheus.MustRegister(PaymentFailures)
	prometheus.MustRegister(PaymentRetries)
	prometheus.MustRegister(LedgerEntriesCreated)
}