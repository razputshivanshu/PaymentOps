from prometheus_client import Counter


payment_webhooks_total = Counter(
    "payment_webhooks_total",
    "Total number of payment webhook requests received",
)

payment_webhooks_duplicates_total = Counter(
    "payment_webhooks_duplicates_total",
    "Total number of duplicate payment webhook events",
)

payment_webhooks_accepted_total = Counter(
    "payment_webhooks_accepted_total",
    "Total number of new payment webhook events accepted",
)