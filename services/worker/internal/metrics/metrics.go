package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	PaymentEventsProcessed = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_events_processed_total",
			Help: "Total number of payment events processed by the worker.",
		},
		[]string{"run"},
	)

	PaymentFailures = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_failures_total",
			Help: "Total number of payment attempts that failed.",
		},
		[]string{"run"},
	)

	PaymentRetries = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_retries_total",
			Help: "Total number of payment retry attempts executed.",
		},
		[]string{"run"},
	)

	LedgerEntriesCreated = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_ledger_entries_created_total",
			Help: "Total number of successful payment ledger entries created.",
		},
		[]string{"run"},
	)
)

func Init() {
	prometheus.MustRegister(PaymentEventsProcessed)
	prometheus.MustRegister(PaymentFailures)
	prometheus.MustRegister(PaymentRetries)
	prometheus.MustRegister(LedgerEntriesCreated)
	Reset()
}

func Reset() {
	counters := []*prometheus.CounterVec{
		PaymentEventsProcessed,
		PaymentFailures,
		PaymentRetries,
		LedgerEntriesCreated,
	}
	for _, counter := range counters {
		counter.Reset()
		counter.WithLabelValues("current").Add(0)
	}
}
