from prometheus_client import Counter


payment_webhooks_total = Counter(
    "payment_webhooks_total",
    "Total number of payment webhook requests received",
    ("run",),
)

payment_webhooks_duplicates_total = Counter(
    "payment_webhooks_duplicates_total",
    "Total number of duplicate payment webhook events",
    ("run",),
)

payment_webhooks_accepted_total = Counter(
    "payment_webhooks_accepted_total",
    "Total number of new payment webhook events accepted",
    ("run",),
)

_counters = (
    payment_webhooks_total,
    payment_webhooks_duplicates_total,
    payment_webhooks_accepted_total,
)


def reset_demo_metrics():
    for counter in _counters:
        counter.clear()
        counter.labels("current").inc(0)


reset_demo_metrics()
