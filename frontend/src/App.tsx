import * as React from 'react'

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bell,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Coins,
  CreditCard,
  Gauge,
  Github,
  HeartPulse,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Repeat2,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { api, apiBase } from './api/client'

type AnyRow = Record<string, any>

type Health = {
  api: string
  postgres: string
  redis: string
  worker: string
}

type Page =
  | 'Payment Ops'
  | 'Overview'
  | 'Mandates'
  | 'Payments'
  | 'Payment Attempts'
  | 'Ledger'
  | 'Events'
  | 'Reliability'
  | 'Metrics'

const nav: { name: Page; icon: typeof LayoutDashboard }[] = [
  { name: 'Payment Ops', icon: Activity },
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Mandates', icon: CreditCard },
  { name: 'Payments', icon: Banknote },
  { name: 'Payment Attempts', icon: Repeat2 },
  { name: 'Ledger', icon: WalletCards },
  { name: 'Events', icon: Radio },
  { name: 'Reliability', icon: ShieldCheck },
  { name: 'Metrics', icon: Gauge },
]

const fmtDate = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—'

const short = (v: unknown, n = 18) => {
  const s = String(v ?? '—')
  return s.length > n ? `${s.slice(0, n)}…` : s
}

const statusClass = (v: unknown) => {
  const s = String(v || '').toLowerCase()

  if (
    ['success', 'processed', 'active', 'accepted', 'ok'].includes(s)
  ) {
    return 'success'
  }

  if (
    ['failed', 'duplicate', 'ignored', 'offline', 'error', 'exhausted'].includes(
      s,
    )
  ) {
    return 'failed'
  }

  if (
    ['pending', 'retrying', 'received', 'created', 'degraded'].includes(s)
  ) {
    return 'pending'
  }

  return 'neutral'
}

function Badge({ value }: { value?: unknown }) {
  const s = String(value || 'UNKNOWN')
  return <span className={`badge ${statusClass(s)}`}>{s}</span>
}

function Head({
  eyebrow = 'OPERATIONS',
  title,
  subtitle,
  right,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

function Panel({
  title,
  caption,
  children,
  action,
}: {
  title: string
  caption?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2 className="panel-title">{title}</h2>
          {caption && <div className="panel-caption">{caption}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Empty({ label = 'No records yet' }: { label?: string }) {
  return <div className="loading">{label}</div>
}

function DataTable({
  cols,
  rows,
  onRow,
}: {
  cols: {
    name: string
    key: string
    render?: (r: AnyRow) => React.ReactNode
  }[]
  rows: AnyRow[]
  onRow?: (r: AnyRow) => void
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr
                key={r.id || r.event_id || r.payment_id || i}
                className={onRow ? 'clickable' : ''}
                onClick={() => onRow?.(r)}
              >
                {cols.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={cols.length}>
                <Empty />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Timeline({
  labels,
  complete,
}: {
  labels: string[]
  complete: number
}) {
  return (
    <div className="timeline">
      {labels.map((label, i) => (
        <div
          className={`timeline-step ${i < complete ? 'done' : ''}`}
          key={label}
        >
          <i /> <b>{label}</b>
        </div>
      ))}
    </div>
  )
}

const metricNames = [
  'payment_webhooks_total',
  'payment_webhooks_duplicates_total',
  'payment_webhooks_accepted_total',
  'payment_events_processed_total',
  'payment_failures_total',
  'payment_retries_total',
  'payment_ledger_entries_created_total',
]

const metricDescription: Record<string, string> = {
  payment_webhooks_total: 'Webhook requests received by FastAPI',
  payment_webhooks_duplicates_total: 'Repeated event IDs safely ignored',
  payment_webhooks_accepted_total: 'New webhook events persisted',
  payment_events_processed_total: 'Events handled by the Go worker',
  payment_failures_total: 'Payment attempts that failed',
  payment_retries_total: 'Retry attempts executed',
  payment_ledger_entries_created_total:
    'Successful financial ledger writes',
}

export default function App() {
  const [page, setPage] = useState<Page>('Payment Ops')

  const [data, setData] = useState<{
    mandates: AnyRow[]
    payments: AnyRow[]
    events: AnyRow[]
    deliveries: AnyRow[]
    attempts: AnyRow[]
    ledger: AnyRow[]
  }>({
    mandates: [],
    payments: [],
    events: [],
    deliveries: [],
    attempts: [],
    ledger: [],
  })

  const [health, setHealth] = useState<Health>({
    api: 'unknown',
    postgres: 'unknown',
    redis: 'unknown',
    worker: 'unknown',
  })

  const [metrics, setMetrics] = useState<Record<string, number>>({})

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{
    text: string
    error?: boolean
  } | null>(null)

  const [mandateModal, setMandateModal] = useState(false)
  const [resetModal, setResetModal] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [resetting, setResetting] = useState(false)
  const [selected, setSelected] = useState<AnyRow | null>(null)
  const [detail, setDetail] = useState<AnyRow | null>(null)
  const [eventFilter, setEventFilter] = useState('All')

  const [scenario, setScenario] = useState<{
    paymentId: string
    eventId: string
    mode: 'success' | 'failed' | 'duplicate'
    replies: AnyRow[]
  } | null>(null)

  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  const refresh = useCallback(async () => {
    const names = [
      'mandates',
      'payments',
      'events',
      'deliveries',
      'attempts',
      'ledger',
    ] as const

    const results = await Promise.allSettled(
      names.map((name) => api<AnyRow[]>(`/${name}`)),
    )

    const next: any = {}
    let failed = ''

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        next[names[i]] = r.value
      } else {
        next[names[i]] = []
        failed = r.reason?.message || 'API unavailable'
      }
    })

    setData(next)
    setError(failed)
    setLoading(false)

    const checks = await Promise.allSettled([
      api<any>('/health'),
      api<any>('/health/db'),
      api<any>('/health/redis'),
    ])

    setHealth({
      api: checks[0].status === 'fulfilled' ? 'healthy' : 'offline',
      postgres: checks[1].status === 'fulfilled' ? 'healthy' : 'offline',
      redis: checks[2].status === 'fulfilled' ? 'healthy' : 'offline',
      worker: 'unknown',
    })

    try {
      const workerMetricsBase =
        import.meta.env.VITE_WORKER_METRICS_URL || '/worker-metrics'
      const workerMetricsUrl =
        workerMetricsBase.startsWith('/') ||
        workerMetricsBase.endsWith('/metrics')
          ? workerMetricsBase
          : `${workerMetricsBase.replace(/\/+$/, '')}/metrics`

      const [apiMetrics, workerMetrics] = await Promise.allSettled([
        fetch(`${apiBase}/metrics`).then((r) => {
          if (!r.ok) throw Error()
          return r.text()
        }),
        fetch(workerMetricsUrl).then((r) => {
          if (!r.ok) throw Error()
          return r.text()
        }),
      ])

      const allText = [
        apiMetrics.status === 'fulfilled' ? apiMetrics.value : '',
        workerMetrics.status === 'fulfilled'
          ? workerMetrics.value
          : '',
      ].join('\n')

      const parsed: Record<string, number> = {}

      for (const metric of metricNames) {
        const line = allText
          .split('\n')
          .find((l) => l.startsWith(`${metric} `))

        if (line) {
          const parts = line.split(/\s+/)
          parsed[metric] = Number(parts[parts.length - 1])
        }
      }

      setMetrics(parsed)

      setHealth((h) => ({
        ...h,
        worker:
          workerMetrics.status === 'fulfilled' ? 'healthy' : 'offline',
      }))
    } catch {
      setHealth((h) => ({ ...h, worker: 'offline' }))
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 3800)
      return () => clearTimeout(id)
    }
  }, [toast])

  useEffect(() => {
    if (selected?.payment_id) {
      api<AnyRow>(
        `/payments/${encodeURIComponent(selected.payment_id)}`,
      )
        .then(setDetail)
        .catch(() => setDetail(null))
    }
  }, [
    selected,
    data.payments.length,
    data.events.length,
    data.attempts.length,
    data.ledger.length,
  ])

  const notify = (text: string, isError = false) =>
    setToast({ text, error: isError })

  const createMandate = async (
    ev: React.FormEvent<HTMLFormElement>,
  ) => {
    ev.preventDefault()

    const form = new FormData(ev.currentTarget)

    try {
      const created = await api<AnyRow>('/mandates', {
        method: 'POST',
        body: JSON.stringify({
          user_id: form.get('user_id'),
          amount: Number(form.get('amount')),
          currency: 'INR',
          frequency: form.get('frequency'),
        }),
      })

      setMandateModal(false)
      await refresh()

      notify(`Mandate ${short(created.id, 12)} created`)
    } catch (e: any) {
      notify(e.message, true)
    }
  }

  const resetDemoData = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault()
    setResetting(true)
    try {
      await api('/admin/reset', {
        method: 'POST',
        headers: { 'X-Reset-Token': resetToken },
      })
      setResetModal(false)
      setResetToken('')
      setResetConfirmation('')
      setSelected(null)
      setDetail(null)
      await refresh()
      notify('Demo data, delivery history, and queued events cleared')
    } catch (e: any) {
      notify(e.message || 'Could not reset demo data', true)
    } finally {
      setResetting(false)
    }
  }

  const closeResetModal = () => {
    if (resetting) return
    setResetModal(false)
    setResetToken('')
    setResetConfirmation('')
  }

  const runScenario = async (
    mode: 'success' | 'failed' | 'duplicate',
    mandate?: AnyRow,
  ) => {
    const target = mandate || data.mandates[0]

    if (!target) {
      setPage('Mandates')
      setMandateModal(true)
      notify(
        'Create a mandate before simulating a payment',
        true,
      )
      return
    }

    const eventId = `evt_demo_${crypto.randomUUID()}`
    const paymentId = `pay_demo_${crypto.randomUUID()}`

    const payload = {
      event_id: eventId,
      payment_id: paymentId,
      mandate_id: target.id,
      event_type:
        mode === 'failed'
          ? 'PAYMENT_FAILED'
          : 'PAYMENT_SUCCESS',
      provider_status:
        mode === 'failed' ? 'FAILED' : 'SUCCESS',
      payload: {
        source: 'engineering_demo',
        scenario: mode,
      },
    }

    setBusy(true)
    setScenario({
      paymentId,
      eventId,
      mode,
      replies: [],
    })

    try {
      const first = await api<AnyRow>('/webhooks/payment', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      const replies = [first]

      if (mode === 'duplicate') {
        replies.push(
          await api<AnyRow>('/webhooks/payment', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
        )
      }

      setScenario({
        paymentId,
        eventId,
        mode,
        replies,
      })

      await refresh()

      notify(
        mode === 'duplicate'
          ? 'Duplicate delivery sent; checking one financial effect'
          : 'Webhook accepted and queued for the worker',
      )
    } catch (e: any) {
      notify(e.message, true)
    } finally {
      setBusy(false)
    }
  }

  const currentPayment = data.payments.find(
    (p) => p.payment_id === scenario?.paymentId,
  )

  const currentAttempts = data.attempts.filter(
    (a) => a.payment_id === scenario?.paymentId,
  )

  const currentLedger = data.ledger.filter(
    (a) => a.payment_id === scenario?.paymentId,
  )

  const chart = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, n) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - n))

      return {
        key: d.toLocaleDateString(),
        day: d.toLocaleDateString([], {
          weekday: 'short',
        }),
        success: 0,
        failed: 0,
        retries: 0,
      }
    })

    data.events.forEach((e) => {
      const d = new Date(e.received_at).toLocaleDateString()
      const entry = days.find((x) => x.key === d)

      if (entry) {
        e.provider_status === 'SUCCESS'
          ? entry.success++
          : entry.failed++
      }
    })

    data.attempts
      .filter((a) => Number(a.attempt_number) > 1)
      .forEach((a) => {
        const d = new Date(a.created_at).toLocaleDateString()
        const entry = days.find((x) => x.key === d)

        if (entry) entry.retries++
      })

    return days
  }, [data.events, data.attempts])

  const successful = data.ledger.length

  const failed = data.attempts.filter(
    (a) => a.status === 'FAILED',
  ).length

  const totalPayments = new Set(
    data.attempts.map((a) => a.payment_id),
  ).size

  const successRate = totalPayments
    ? Math.round((successful / totalPayments) * 100)
    : 0

  const filteredEvents = data.events
    .filter(
      (e) =>
        eventFilter === 'All' ||
        String(e.status).toLowerCase() ===
          eventFilter.toLowerCase(),
    )
    .filter(
      (e) =>
        !search ||
        `${e.event_id} ${e.payment_id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )

  const statusBar = (
    <div className="top-status">
      {(
        [
          ['API', health.api],
          ['Postgres', health.postgres],
          ['Redis', health.redis],
          ['Worker', health.worker],
        ] as const
      ).map(([label, state]) => (
        <div
          className="health-item"
          key={label}
          title={`${label}: ${state}`}
        >
          <i
            className={`dot ${
              state === 'healthy'
                ? 'ok'
                : state === 'offline'
                  ? 'bad'
                  : 'warn'
            }`}
          />
          {label}
          <strong
            style={{
              fontWeight: 550,
              color: '#8a96a2',
            }}
          >
            {state === 'unknown' ? '…' : ''}
          </strong>
        </div>
      ))}
    </div>
  )

  const kpis = [
    [
      'Total Payment Events',
      data.events.length,
      Radio,
      'Persisted webhook events',
    ],
    [
      'Successful Payments',
      successful,
      BadgeCheck,
      'Ledger backed',
    ],
    [
      'Failed Payments',
      failed,
      AlertTriangle,
      'Failed attempts',
    ],
    [
      'Retry Attempts',
      metrics.payment_retries_total ??
        data.attempts.filter(
          (a) => Number(a.attempt_number) > 1,
        ).length,
      Repeat2,
      'Worker metric / attempt records',
    ],
    [
      'Duplicate Events',
      `${
        metrics.payment_webhooks_duplicates_total ?? 0
      } · ${
        metrics.payment_webhooks_total
          ? Math.round(
              ((metrics.payment_webhooks_duplicates_total || 0) /
                metrics.payment_webhooks_total) *
                100,
            )
          : 0
      }%`,
      CopyIcon,
      'Duplicate count · delivery rate',
    ],
    [
      'Ledger Entries',
      data.ledger.length,
      WalletCards,
      'Financial source of truth',
    ],
    [
      'Active Mandates',
      data.mandates.filter(
        (m) => m.status === 'ACTIVE',
      ).length,
      CreditCard,
      'ACTIVE mandates',
    ],
  ] as const

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={18} />
          </div>
          <span className="brand-name">PAYMENT OPS</span>
        </div>

        <div className="nav-label">Workspace</div>

        {nav.map((item) => (
          <button
            className={`nav-link ${
              page === item.name ? 'active' : ''
            }`}
            key={item.name}
            onClick={() => {
              setPage(item.name)
              setSelected(null)
            }}
          >
            <item.icon size={16} />
            <span>{item.name}</span>
          </button>
        ))}

        <div className="side-bottom">
          <div className="side-note">
            Independent engineering demo
            <br />
            Recurring payment reliability
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            Operations
            <ChevronRight
              size={12}
              style={{
                verticalAlign: 'middle',
                margin: '0 4px',
              }}
            />
            {selected
              ? `Payment ${short(selected.payment_id, 16)}`
              : page}
          </div>

          {statusBar}

          <button
            className="close"
            aria-label="refresh"
            title="Refresh data"
            onClick={refresh}
          >
            <RefreshCw size={15} />
          </button>
        </header>

        <div className="content">
          {error && (
            <div
              className="error-box"
              style={{ marginBottom: 16 }}
            >
              API connection issue: {error}
              <button
                className="btn"
                onClick={refresh}
                style={{ marginLeft: 10 }}
              >
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          )}

          {page === 'Payment Ops' ? (
            <PaymentOpsPage onNavigate={setPage} />
          ) : selected ? (
            <>
              <Head
                eyebrow="PAYMENT DETAIL"
                title={selected.payment_id}
                subtitle={`Mandate ID ${
                  detail?.attempts?.[0]?.mandate_id ||
                  selected.mandate_id ||
                  'pending'
                } · Live details from payment attempts, persisted webhook events, and ledger records.`}
                right={
                  <button
                    className="btn"
                    onClick={() => {
                      setSelected(null)
                      setDetail(null)
                    }}
                  >
                    <X size={14} /> Close detail
                  </button>
                }
              />

              {detail ? (
                <PaymentDetail detail={detail} />
              ) : (
                <div className="panel loading">
                  Loading payment detail…
                </div>
              )}
            </>
          ) : page === 'Overview' ? (
            <>
              <Head
                eyebrow="SYSTEM OVERVIEW"
                title="Payment operations"
                subtitle="Observe how events move through the recurring payment pipeline."
                right={
                  <div className="health-item">
                    <i className="dot ok" /> Polling every 4 seconds
                  </div>
                }
              />

              <div className="kpi-grid">
                {kpis.map(
                  ([label, value, Icon, foot]) => (
                    <div className="kpi" key={label}>
                      <div className="kpi-top">
                        {label}
                        <span className="kpi-icon">
                          <Icon size={14} />
                        </span>
                      </div>

                      <div className="kpi-value">
                        {value}
                      </div>

                      <div className="kpi-foot">
                        {foot}
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="grid-main">
                <Panel
                  title="Payment activity"
                  caption="Events and attempts recorded in the last 7 days"
                >
                  <div className="chart-wrap">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                    >
                      <AreaChart
                        data={chart}
                        margin={{
                          top: 8,
                          right: 8,
                          left: -22,
                          bottom: 0,
                        }}
                      >
                        <defs>
                          <linearGradient
                            id="successFill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#5a9a74"
                              stopOpacity={0.18}
                            />
                            <stop
                              offset="95%"
                              stopColor="#5a9a74"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>

                        <CartesianGrid
                          vertical={false}
                          stroke="#edf0f2"
                        />

                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: '#8a96a1',
                            fontSize: 10,
                          }}
                        />

                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: '#8a96a1',
                            fontSize: 10,
                          }}
                        />

                        <Tooltip
                          contentStyle={{
                            border:
                              '1px solid #e8ecef',
                            borderRadius: 8,
                            fontSize: 11,
                          }}
                        />

                        <Area
                          type="monotone"
                          dataKey="success"
                          name="Successful"
                          stroke="#579a72"
                          fill="url(#successFill)"
                          strokeWidth={2}
                        />

                        <Area
                          type="monotone"
                          dataKey="failed"
                          name="Failed"
                          stroke="#d67669"
                          fill="transparent"
                          strokeWidth={2}
                        />

                        <Area
                          type="monotone"
                          dataKey="retries"
                          name="Retries"
                          stroke="#d2a044"
                          fill="transparent"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                <Panel
                  title="Payment success rate"
                  caption="Successful ledger effects divided by observed payments"
                >
                  <div className="success-block">
                    <div>
                      <div className="success-rate">
                        {successRate}%
                      </div>

                      <div className="success-label">
                        {totalPayments} payments observed
                      </div>
                    </div>

                    <div className="success-ring">
                      <span>{successRate}%</span>
                    </div>
                  </div>

                  <div
                    className="notice"
                    style={{ marginTop: 18 }}
                  >
                    Based on current database records. The rate
                    updates as attempts and ledger entries arrive.
                  </div>
                </Panel>
              </div>

              <div className="grid-equal">
                <Panel
                  title="Recent payment events"
                  caption="Most recently persisted webhook deliveries"
                  action={
                    <button
                      className="btn"
                      onClick={() => setPage('Events')}
                    >
                      View events
                      <ArrowUpRight size={13} />
                    </button>
                  }
                >
                  <DataTable
                    cols={[
                      {
                        name: 'Event ID',
                        key: 'event_id',
                        render: (r) => (
                          <span className="mono">
                            {short(r.event_id)}
                          </span>
                        ),
                      },
                      {
                        name: 'Payment ID',
                        key: 'payment_id',
                        render: (r) => (
                          <span className="mono">
                            {short(r.payment_id)}
                          </span>
                        ),
                      },
                      {
                        name: 'Type',
                        key: 'event_type',
                      },
                      {
                        name: 'Status',
                        key: 'status',
                        render: (r) => (
                          <Badge value={r.status} />
                        ),
                      },
                      {
                        name: 'Received',
                        key: 'received_at',
                        render: (r) =>
                          fmtDate(r.received_at),
                      },
                    ]}
                    rows={data.events.slice(0, 5)}
                    onRow={(r) => {
                      const p =
                        data.payments.find(
                          (x) =>
                            x.payment_id === r.payment_id,
                        ) || {
                          payment_id: r.payment_id,
                        }

                      setSelected(p)
                    }}
                  />
                </Panel>

                <Panel
                  title="Reliability controls"
                  caption="Protection built into the processing flow"
                >
                  <div className="reliability-list">
                    {[
                      [
                        'Webhook Idempotency',
                        'Protected',
                      ],
                      [
                        'Payment Idempotency',
                        'Protected',
                      ],
                      [
                        'At-Least-Once Delivery',
                        'Enabled',
                      ],
                      ['Retry Mechanism', 'Enabled'],
                      ['Crash Recovery', 'Enabled'],
                      [
                        'Financial Transaction Safety',
                        'Enabled',
                      ],
                    ].map(([l, v]) => (
                      <div
                        className="reliability-chip"
                        key={l}
                      >
                        <strong>{l}</strong>
                        <span>
                          <Check size={12} /> {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>

              <Panel
                title="Reset demo data"
                caption="Clear saved payment records and queued events before another walkthrough."
                action={
                  <button
                    className="btn"
                    onClick={() => setResetModal(true)}
                  >
                    <Trash2 size={14} /> Reset data
                  </button>
                }
              >
                <div className="notice">
                  This permanently removes mandates, payment attempts, webhook events and delivery history, ledger entries, and pending Redis stream events. It does not delete the Render database or reset process metrics.
                </div>
              </Panel>
            </>
          ) : page === 'Mandates' ? (
            <>
              <Head
                title="Mandates"
                subtitle="Recurring payment authorizations persisted by FastAPI."
                right={
                  <button
                    className="btn primary"
                    onClick={() =>
                      setMandateModal(true)
                    }
                  >
                    <Plus size={14} /> Create mandate
                  </button>
                }
              />

              <Panel
                title="Mandate register"
                caption={`${data.mandates.length} mandates`}
              >
                <DataTable
                  cols={[
                    {
                      name: 'Mandate ID',
                      key: 'id',
                      render: (r) => (
                        <span className="mono">
                          {short(r.id, 21)}
                        </span>
                      ),
                    },
                    {
                      name: 'Amount',
                      key: 'amount',
                      render: (r) =>
                        `${r.currency || 'INR'} ${Number(
                          r.amount,
                        ).toFixed(2)}`,
                    },
                    {
                      name: 'Frequency',
                      key: 'frequency',
                    },
                    {
                      name: 'Status',
                      key: 'status',
                      render: (r) => (
                        <Badge value={r.status} />
                      ),
                    },
                    {
                      name: 'Next charge',
                      key: 'next_charge_at',
                      render: (r) =>
                        fmtDate(r.next_charge_at),
                    },
                    {
                      name: 'Created at',
                      key: 'created_at',
                      render: (r) =>
                        fmtDate(r.created_at),
                    },
                  ]}
                  rows={data.mandates}
                />
              </Panel>
            </>
          ) : page === 'Payments' ? (
            <>
              <Head
                title="Payments"
                subtitle="Trigger real webhook events and follow their processing through the worker."
              />

              <div className="scenario-grid">
                {[
                  [
                    'success',
                    'Simulate successful payment',
                    'Creates a successful webhook event. The worker records an attempt and a ledger entry.',
                    BadgeCheck,
                  ],
                  [
                    'failed',
                    'Simulate failed payment',
                    'Records the provider failure and schedules the worker retry. Watch the retry and ledger state update.',
                    AlertTriangle,
                  ],
                  [
                    'duplicate',
                    'Send duplicate webhook',
                    'Submits the exact same event_id twice. The second delivery should be ignored.',
                    Repeat2,
                  ],
                ].map(
                  ([
                    mode,
                    title,
                    text,
                    Icon,
                  ]: any) => (
                    <div
                      className="scenario"
                      key={mode}
                    >
                      <div className="scenario-icon">
                        <Icon size={17} />
                      </div>

                      <h3>{title}</h3>
                      <p>{text}</p>

                      <button
                        className={`btn ${
                          mode === 'success'
                            ? 'lime'
                            : ''
                        }`}
                        onClick={() =>
                          runScenario(mode)
                        }
                        disabled={busy}
                      >
                        <Plus size={13} /> Run scenario
                      </button>
                    </div>
                  ),
                )}
              </div>

              {scenario && (
                <div
                  className="panel"
                  style={{ marginBottom: 15 }}
                >
                  <div className="section-head">
                    <div>
                      <h2 className="panel-title">
                        Scenario run · {scenario.mode}
                      </h2>

                      <div className="panel-caption">
                        Payment{' '}
                        <span className="mono">
                          {scenario.paymentId}
                        </span>{' '}
                        · Event{' '}
                        <span className="mono">
                          {scenario.eventId}
                        </span>
                      </div>
                    </div>

                    <Badge
                      value={
                        currentLedger.length
                          ? 'SUCCESS'
                          : currentAttempts.length
                            ? currentAttempts[
                                currentAttempts.length - 1
                              ].status
                            : 'PENDING'
                      }
                    />
                  </div>

                  {scenario.mode === 'failed' ? (
                    <Timeline
                      labels={[
                        'Webhook received',
                        'Event persisted',
                        'Redis stream',
                        'Attempt failed',
                        'Retry scheduled',
                        'Retry success',
                        'Ledger entry',
                      ]}
                      complete={
                        currentLedger.length
                          ? 7
                          : currentAttempts.some(
                                (a) =>
                                  Number(
                                    a.attempt_number,
                                  ) > 1,
                              )
                            ? 6
                            : currentAttempts.length
                              ? 5
                              : scenario.replies
                                    .length
                                ? 3
                                : 0
                      }
                    />
                  ) : (
                    <Timeline
                      labels={[
                        'Webhook received',
                        'Event persisted',
                        'Redis stream',
                        'Worker processing',
                        'Payment attempt',
                        'Ledger entry',
                        'ACK',
                      ]}
                      complete={
                        currentLedger.length
                          ? 6
                          : currentAttempts.length
                            ? 5
                            : scenario.replies
                                  .length
                              ? 3
                              : 0
                      }
                    />
                  )}

                  <div className="grid-equal">
                    <div className="notice">
                      Delivery responses:{' '}
                      {scenario.replies.map(
                        (r, i) => (
                          <span
                            key={i}
                            style={{
                              marginLeft: 9,
                            }}
                          >
                            <Badge
                              value={r.status}
                            />
                          </span>
                        ),
                      )}

                      {scenario.mode ===
                        'duplicate' && (
                        <div
                          style={{
                            marginTop: 8,
                          }}
                        >
                          {scenario.replies.length} deliveries · one event record ·{' '}
                          {currentAttempts.length || 0}{' '}
                          attempts ·{' '}
                          {currentLedger.length || 0}{' '}
                          ledger entries
                        </div>
                      )}
                    </div>

                    <div className="notice">
                      Attempts:{' '}
                      {currentAttempts.length
                        ? currentAttempts
                            .map(
                              (a) =>
                                `#${a.attempt_number} ${a.status}${
                                  a.error_code
                                    ? ` (${a.error_code})`
                                    : ''
                                }`,
                            )
                            .join(' → ')
                        : 'Awaiting worker processing'}
                      <br />
                      Ledger effects:{' '}
                      {currentLedger.length}
                    </div>
                  </div>
                </div>
              )}

              <Panel
                title="Recent payments"
                caption="Select a payment to inspect attempts, events, and ledger effects"
              >
                <DataTable
                  cols={[
                    {
                      name: 'Payment ID',
                      key: 'payment_id',
                      render: (r) => (
                        <span className="mono">
                          {r.payment_id}
                        </span>
                      ),
                    },
                    {
                      name: 'Mandate',
                      key: 'mandate_id',
                      render: (r) => (
                        <span className="mono">
                          {short(r.mandate_id)}
                        </span>
                      ),
                    },
                    {
                      name: 'Status',
                      key: 'status',
                      render: (r) => (
                        <Badge value={r.status} />
                      ),
                    },
                    {
                      name: 'Attempts',
                      key: 'attempts',
                    },
                    {
                      name: 'Updated',
                      key: 'updated_at',
                      render: (r) =>
                        fmtDate(r.updated_at),
                    },
                    {
                      name: '',
                      key: 'open',
                      render: () => (
                        <ChevronRight size={14} />
                      ),
                    },
                  ]}
                  rows={data.payments}
                  onRow={setSelected}
                />
              </Panel>
            </>
          ) : page === 'Events' ? (
            <>
              <Head
                title="Webhook events"
                subtitle="See unique payment events separately from every webhook delivery, including duplicates."
              />

              <Panel
                title="Event log"
                caption={`${filteredEvents.length} events shown`}
                action={
                  <div className="toolbar">
                    <Search
                      size={13}
                      color="#8994a0"
                    />

                    <input
                      className="select-small"
                      placeholder="Find event or payment"
                      value={search}
                      onChange={(e) =>
                        setSearch(e.target.value)
                      }
                    />

                    <ListFilter
                      size={13}
                      color="#8994a0"
                    />

                    <select
                      className="select-small"
                      value={eventFilter}
                      onChange={(e) =>
                        setEventFilter(e.target.value)
                      }
                    >
                      <option>All</option>
                      <option>Processed</option>
                      <option>Ignored</option>
                      <option>Received</option>
                    </select>
                  </div>
                }
              >
                <DataTable
                  cols={[
                    {
                      name: 'Event ID',
                      key: 'event_id',
                      render: (r) => (
                        <span className="mono">
                          {r.event_id}
                        </span>
                      ),
                    },
                    {
                      name: 'Payment ID',
                      key: 'payment_id',
                      render: (r) => (
                        <span className="mono">
                          {r.payment_id}
                        </span>
                      ),
                    },
                    {
                      name: 'Event type',
                      key: 'event_type',
                    },
                    {
                      name: 'Provider',
                      key: 'provider_status',
                      render: (r) => (
                        <Badge
                          value={r.provider_status}
                        />
                      ),
                    },
                    {
                      name: 'Processing',
                      key: 'status',
                      render: (r) => (
                        <Badge value={r.status} />
                      ),
                    },
                    {
                      name: 'Received at',
                      key: 'received_at',
                      render: (r) =>
                        fmtDate(r.received_at),
                    },
                  ]}
                  rows={filteredEvents}
                  onRow={(r) =>
                    setSelected({
                      payment_id: r.payment_id,
                    })
                  }
                />
              </Panel>

              <Panel
                title="Webhook delivery history"
                caption={`${data.deliveries.length} deliveries · duplicate requests are recorded here, not in the ledger`}
              >
                <DataTable
                  cols={[
                    {
                      name: 'Event ID',
                      key: 'event_id',
                      render: (r) => (
                        <span className="mono">{r.event_id}</span>
                      ),
                    },
                    {
                      name: 'Payment ID',
                      key: 'payment_id',
                      render: (r) => (
                        <span className="mono">{r.payment_id}</span>
                      ),
                    },
                    {
                      name: 'Delivery result',
                      key: 'status',
                      render: (r) => <Badge value={r.status} />,
                    },
                    {
                      name: 'Received at',
                      key: 'received_at',
                      render: (r) => fmtDate(r.received_at),
                    },
                  ]}
                  rows={data.deliveries}
                  onRow={(r) =>
                    setSelected({ payment_id: r.payment_id })
                  }
                />
              </Panel>
            </>
          ) : page === 'Payment Attempts' ? (
            <>
              <Head
                title="Payment attempts"
                subtitle="Provider outcomes and persisted retry scheduling."
              />

              <Panel
                title="Attempt ledger"
                caption={`${data.attempts.length} attempts`}
              >
                <DataTable
                  cols={[
                    {
                      name: 'Attempt',
                      key: 'attempt_number',
                      render: (r) =>
                        `#${r.attempt_number}`,
                    },
                    {
                      name: 'Payment ID',
                      key: 'payment_id',
                      render: (r) => (
                        <span className="mono">
                          {r.payment_id}
                        </span>
                      ),
                    },
                    {
                      name: 'Status',
                      key: 'status',
                      render: (r) => (
                        <Badge value={r.status} />
                      ),
                    },
                    {
                      name: 'Provider reference',
                      key: 'provider_reference',
                    },
                    {
                      name: 'Error code',
                      key: 'error_code',
                    },
                    {
                      name: 'Error message',
                      key: 'error_message',
                    },
                    {
                      name: 'Next retry',
                      key: 'next_retry_at',
                      render: (r) =>
                        fmtDate(r.next_retry_at),
                    },
                    {
                      name: 'Created',
                      key: 'created_at',
                      render: (r) =>
                        fmtDate(r.created_at),
                    },
                  ]}
                  rows={data.attempts}
                  onRow={(r) =>
                    setSelected({
                      payment_id: r.payment_id,
                    })
                  }
                />
              </Panel>
            </>
          ) : page === 'Ledger' ? (
            <>
              <Head
                eyebrow="FINANCIAL SOURCE OF TRUTH"
                title="Ledger entries"
                subtitle="Committed payment effects recorded by the worker in PostgreSQL."
              />

              <Panel
                title="Gold credit entries"
                caption={`${data.ledger.length} entries · unique by payment and entry type`}
              >
                <DataTable
                  cols={[
                    {
                      name: 'Payment ID',
                      key: 'payment_id',
                      render: (r) => (
                        <span className="mono">
                          {r.payment_id}
                        </span>
                      ),
                    },
                    {
                      name: 'Entry type',
                      key: 'entry_type',
                      render: (r) => (
                        <Badge value={r.entry_type} />
                      ),
                    },
                    {
                      name: 'Quantity',
                      key: 'quantity',
                    },
                    {
                      name: 'Asset',
                      key: 'asset',
                    },
                    {
                      name: 'Status',
                      key: 'status',
                      render: () => (
                        <Badge value="SUCCESS" />
                      ),
                    },
                    {
                      name: 'Created at',
                      key: 'created_at',
                      render: (r) =>
                        fmtDate(r.created_at),
                    },
                  ]}
                  rows={data.ledger}
                  onRow={(r) =>
                    setSelected({
                      payment_id: r.payment_id,
                    })
                  }
                />
              </Panel>

              <div
                className="notice"
                style={{ marginTop: 14 }}
              >
                Each ledger entry is created in the same
                PostgreSQL transaction as the successful
                payment attempt and processed event. This
                table reflects persisted records.
              </div>
            </>
          ) : page === 'Reliability' ? (
            <>
              <Head
                eyebrow="RELIABILITY CONTROL CENTER"
                title="System reliability"
                subtitle="Operational signals and safeguards observed from the running services."
              />

              <div className="kpi-grid">
                {[
                  [
                    'Webhook requests',
                    metrics.payment_webhooks_total ?? '—',
                  ],
                  [
                    'Duplicate deliveries',
                    metrics.payment_webhooks_duplicates_total ??
                      '—',
                  ],
                  [
                    'Accepted events',
                    metrics.payment_webhooks_accepted_total ??
                      '—',
                  ],
                  [
                    'Events processed',
                    metrics.payment_events_processed_total ??
                      '—',
                  ],
                  [
                    'Payment failures',
                    metrics.payment_failures_total ?? '—',
                  ],
                  [
                    'Worker retries',
                    metrics.payment_retries_total ?? '—',
                  ],
                  [
                    'Ledger writes',
                    metrics.payment_ledger_entries_created_total ??
                      '—',
                  ],
                  ['Redis pending', 'Not exposed'],
                ].map(([l, v]) => (
                  <div
                    className="kpi"
                    key={l}
                  >
                    <div className="kpi-top">
                      {l}
                      <span className="kpi-icon">
                        <Activity size={14} />
                      </span>
                    </div>

                    <div
                      className="kpi-value"
                      style={{ fontSize: 23 }}
                    >
                      {v}
                    </div>

                    <div className="kpi-foot">
                      Live service metrics
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid-equal">
                <Panel
                  title="System flow"
                  caption="Events move asynchronously; the worker commits before acknowledging"
                >
                  <div className="flow">
                    {[
                      'Client / Provider',
                      'FastAPI',
                      'PostgreSQL',
                      'Redis Streams',
                      'Go Worker',
                      'Payment Provider',
                      'PostgreSQL Ledger',
                    ].map((v, i) => (
                      <React.Fragment key={v}>
                        <div className="flow-node">
                          {v}
                        </div>

                        {i < 6 && (
                          <div className="flow-arrow">
                            <ChevronRight
                              size={14}
                            />
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="health-grid">
                    {Object.entries(health).map(
                      ([k, v]) => (
                        <span
                          className="health-item"
                          key={k}
                        >
                          <i
                            className={`dot ${
                              v === 'healthy'
                                ? 'ok'
                                : v === 'offline'
                                  ? 'bad'
                                  : 'warn'
                            }`}
                          />
                          {k.toUpperCase()}{' '}
                          <Badge value={v} />
                        </span>
                      ),
                    )}
                  </div>
                </Panel>

                <Panel
                  title="Reliability principles"
                  caption="Implemented in the backend flow"
                >
                  <div className="principles">
                    {[
                      [
                        'AT-LEAST-ONCE DELIVERY',
                        'Redis consumer group',
                      ],
                      [
                        'IDEMPOTENT PROCESSING',
                        'Event and payment keys',
                      ],
                      [
                        'TRANSACTIONAL LEDGER',
                        'PostgreSQL commit boundary',
                      ],
                      [
                        'ACK AFTER COMMIT',
                        'Worker acknowledges after commit',
                      ],
                      [
                        'RETRY WITH BACKOFF',
                        'Persistent retry timestamp',
                      ],
                      [
                        'WORKER RECOVERY',
                        'Pending message XAUTOCLAIM',
                      ],
                    ].map(([a, b]) => (
                      <div
                        className="principle"
                        key={a}
                      >
                        <strong>{a}</strong>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </>
          ) : (
            <>
              <Head
                title="Metrics"
                subtitle="Prometheus counters from FastAPI and the Go worker. Worker scrape is reported unavailable when unreachable."
                right={
                  <button
                    className="btn"
                    onClick={refresh}
                  >
                    <RefreshCw size={13} /> Refresh
                  </button>
                }
              />

              <div className="metric-grid">
                {metricNames.map((m) => (
                  <div
                    className="metric-card"
                    key={m}
                  >
                    <code>{m}</code>

                    <strong>
                      {metrics[m] === undefined
                        ? '—'
                        : metrics[m]}
                    </strong>

                    <p>{metricDescription[m]}</p>
                  </div>
                ))}
              </div>

              {health.worker !==
                'healthy' && (
                <div
                  className="notice"
                  style={{ marginTop: 14 }}
                >
                  Go worker metrics endpoint unavailable. Worker-only
                  counters show as unavailable.
                </div>
              )}
            </>
          )}

          {loading && !error && (
            <div className="loading">
              Loading live backend data…
            </div>
          )}

          {mandateModal && (
            <div
              className="modal-backdrop"
              onClick={(e) =>
                e.target === e.currentTarget &&
                setMandateModal(false)
              }
            >
              <form
                className="modal"
                onSubmit={createMandate}
              >
                <div className="modal-head">
                  <div>
                    <p className="eyebrow">
                      NEW AUTHORIZATION
                    </p>

                    <h2 className="panel-title">
                      Create mandate
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="close"
                    onClick={() =>
                      setMandateModal(false)
                    }
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="field">
                  <label>User ID</label>

                  <input
                    name="user_id"
                    required
                    defaultValue={crypto.randomUUID()}
                  />
                </div>

                <div className="field">
                  <label>Amount (INR)</label>

                  <input
                    name="amount"
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    placeholder="2500.00"
                  />
                </div>

                <div className="field">
                  <label>Frequency</label>

                  <select name="frequency">
                    <option>MONTHLY</option>
                    <option>WEEKLY</option>
                    <option>DAILY</option>
                  </select>
                </div>

                <div
                  className="actions"
                  style={{
                    justifyContent: 'flex-end',
                    marginTop: 20,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setMandateModal(false)
                    }
                  >
                    Cancel
                  </button>

                  <button className="btn primary">
                    <Plus size={14} /> Create mandate
                  </button>
                </div>
              </form>
            </div>
          )}

          {resetModal && (
            <div
              className="modal-backdrop"
              onClick={(e) =>
                e.target === e.currentTarget &&
                closeResetModal()
              }
            >
              <form className="modal" onSubmit={resetDemoData}>
                <div className="modal-head">
                  <div>
                    <p className="eyebrow">DESTRUCTIVE ACTION</p>
                    <h2 className="panel-title">Reset demo data?</h2>
                  </div>
                  <button
                    type="button"
                    className="close"
                    disabled={resetting}
                    aria-label="Close reset dialog"
                    onClick={closeResetModal}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="notice" style={{ marginTop: 16 }}>
                  This clears all saved demo records and queued events. To authorize it, copy <code>RESET_TOKEN</code> from Render → <code>paymentops-api</code> → Environment.
                </div>

                <div className="field">
                  <label htmlFor="reset-token">Reset token</label>
                  <input
                    id="reset-token"
                    type="password"
                    autoComplete="off"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="reset-confirmation">Type RESET to confirm</label>
                  <input
                    id="reset-confirmation"
                    autoComplete="off"
                    required
                    value={resetConfirmation}
                    onChange={(e) => setResetConfirmation(e.target.value)}
                  />
                </div>

                <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={resetting}
                    onClick={closeResetModal}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    disabled={resetting || resetConfirmation !== 'RESET'}
                  >
                    <Trash2 size={14} /> {resetting ? 'Resetting…' : 'Clear demo data'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {toast && (
            <div
              className={`toast ${
                toast.error ? 'error' : ''
              }`}
            >
              {toast.error && (
                <AlertTriangle
                  size={14}
                  style={{
                    marginRight: 7,
                    verticalAlign: 'middle',
                  }}
                />
              )}
              {toast.text}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function CopyIcon({
  size = 14,
}: {
  size?: number
}) {
  return <Shield size={size} />
}

function PaymentOpsPage({
  onNavigate,
}: {
  onNavigate: (page: Page) => void
}) {
  const githubUrl =
    import.meta.env.VITE_GITHUB_URL ||
    'https://github.com/razputshivanshu/PaymentOps'

  const technologies = [
    'React',
    'TypeScript',
    'Vite',
    'Tailwind CSS',
    'FastAPI',
    'Python',
    'PostgreSQL',
    'Redis Streams',
    'Go',
    'Prometheus',
    'Docker',
  ]

  return (
    <>
      <Head
        eyebrow="BUILT IN 2 DAYS · INDEPENDENT ENGINEERING DEMO"
        title="Why I chose to build this"
        subtitle="A real problem caught my attention. I chose a smaller slice, built it in 2 days, and made the engineering decisions visible."
        right={
          <a
            className="btn"
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={14} />
            GitHub
            <ArrowUpRight size={13} />
          </a>
        }
      />

      <Panel
        title="The story behind the project"
        caption="Why I chose to build instead of only describing an idea"
      >
        <div className="story-copy">

          <p>
            <strong>
              I wanted to introduce myself by building
              something, rather than only sending a resume.
            </strong>
          </p>

          <p>
            While exploring Aura Gold and the engineering
            problems around recurring payments, I came
            across the Cashfree case study{' '}
            <strong>
              “How Aura Gold Scaled Recurring Investments
              While Maintaining 90+% Success Rate.”
            </strong>
          </p>

          <p>
            What caught my attention wasn't just the scale.
            It was the engineering problem underneath it:
            recurring payments have to remain reliable even
            when mandates change, events are delivered more
            than once, payments fail, or processing is
            interrupted.
          </p>

          <p>
            That led me to a question I could actually
            explore myself:
          </p>

          <blockquote>
            What happens when the same payment event arrives
            twice, a payment fails, or a worker disappears in
            the middle of processing?
          </blockquote>

          <p>
            I deliberately kept the scope small and focused
            on one reliability slice. I built an independent
            recurring-payment orchestration system with{' '}
            <strong>
              webhook idempotency, payment-level
              idempotency, retries, worker recovery,
              transactional ledger updates, Redis Streams,
              and observability.
            </strong>
          </p>

          <p>
            <strong>
              I built and tested this in 2 days.
            </strong>{' '}
            The goal wasn't to recreate a production payment
            platform. It was to take a real domain problem,
            understand it from first principles, make sensible
            engineering trade-offs, and turn the idea into a
            working system that I could actually demonstrate.
          </p>

          <p>
            I also came across your post about the{' '}
            <strong>SDE Intern opportunity at Aura Gold</strong>,
            where you mentioned that you value people who
            have actually built things, broken things, fixed
            them, and can explain why they made their technical
            decisions.
          </p>

          <p>
            That resonated with me. I don't come from a
            traditional product-based company background.
            What I do have is a{' '}
            <strong>builder mindset</strong> — taking a
            problem from fundamentals, understanding the
            pieces, and pushing it from a basic idea toward a
            working system.
          </p>

          <p>
            From the beginning, I've wanted to work in a{' '}
            <strong>startup environment</strong> where I can
            take ownership, learn quickly, work close to the
            problem, and contribute beyond a narrowly defined
            task.
          </p>

          <p>
            I'm currently looking for a{' '}
            <strong>
              full-time software engineering opportunity
            </strong>
            , rather than an internship. So instead of
            sending you another resume and asking you to judge
            what I might be able to build, I thought I'd show
            you something I actually built.
          </p>

          <p>
            <strong>
              I know your time as a CTO is valuable, so I
              wanted this project to do some of the talking
              for me.
            </strong>
          </p>

          <p>
            This is a small demonstration of how I approach
            problems, make engineering decisions, debug
            failures, and turn an idea into a working system.
          </p>

        </div>

        <div className="source-card">
          <div>
            <strong>
              Source that inspired the problem
            </strong>

            <span>
              Cashfree × Aura Gold case study
            </span>
          </div>

          <a
            href="https://www.cashfree.com/case-study/how-aura-gold-scaled-recurring-investments-while-maintaining-90-success-rate/?utm_source=chatgpt.com"
            target="_blank"
            rel="noreferrer"
          >
            Read the case study{' '}
            <ArrowUpRight size={13} />
          </a>
        </div>

        <div
          className="notice"
          style={{ marginTop: 12 }}
        >
          <strong>
            Independent engineering demo:
          </strong>{' '}
          This project is inspired by publicly documented
          recurring-payment reliability challenges. It is{' '}
          <strong>
            not Aura Gold's production system, architecture,
            or internal implementation.
          </strong>
        </div>
      </Panel>

      <div style={{ marginTop: 15 }}>
        <Panel
          title="What I built"
          caption="From problem → design → implementation → observable system"
        >
          <div className="intro-feature">
            <span className="kpi-icon">
              <Server size={15} />
            </span>

            <div>
              <strong>
                Payment processing backend
              </strong>

              <p>
                FastAPI accepts and stores webhook events,
                Redis Streams delivers work, and a Go worker
                records attempts and ledger entries in
                PostgreSQL.
              </p>
            </div>
          </div>

          <div className="intro-feature">
            <span className="kpi-icon">
              <Activity size={15} />
            </span>

            <div>
              <strong>
                Operations dashboard
              </strong>

              <p>
                Inspect mandates, events, attempts, ledger
                entries, health, and metrics. Trigger
                success, duplicate, and failure-with-retry
                scenarios.
              </p>
            </div>
          </div>

          <div className="intro-feature">
            <span className="kpi-icon">
              <ShieldCheck size={15} />
            </span>

            <div>
              <strong>
                Reliability demonstrations
              </strong>

              <p>
                See event idempotency, payment-level
                financial protection, delayed retry, and
                Redis pending-message recovery behavior.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid-equal">
        <Panel
          title="Technology"
          caption="Tools used in this implementation"
        >
          <div className="tech-list">
            {technologies.map((tech) => (
              <span
                className="tech-tag"
                key={tech}
              >
                {tech}
              </span>
            ))}
          </div>
        </Panel>

        <Panel
          title="System flow"
          caption="From webhook delivery to the persisted financial record"
        >
          <div className="intro-flow">
            <span>FastAPI</span>
            <ChevronRight size={14} />
            <span>PostgreSQL</span>
            <ChevronRight size={14} />
            <span>Redis Streams</span>
            <ChevronRight size={14} />
            <span>Go worker</span>
            <ChevronRight size={14} />
            <span>Ledger</span>
          </div>

          <p
            className="panel-caption"
            style={{ marginTop: 13 }}
          >
            The mock provider is simulated in the worker. The
            demo does not send real payments.
          </p>
        </Panel>
      </div>

      <div className="intro-footer">
        <span>Ready to inspect the live service?</span>

        <button
          className="btn primary"
          onClick={() => onNavigate('Overview')}
        >
          Open overview
          <ArrowRight size={14} />
        </button>
      </div>
    </>
  )
}

function PaymentDetail({
  detail,
}: {
  detail: AnyRow
}) {
  const attempts = detail.attempts || []
  const events = detail.events || []
  const ledger = detail.ledger || []

  const last = attempts.length
    ? attempts[attempts.length - 1]
    : undefined

  return (
    <>
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-top">
            Current status
            <CircleDot size={14} />
          </div>

          <div
            className="kpi-value"
            style={{ fontSize: 18 }}
          >
            {last?.status || 'PENDING'}
          </div>

          <div className="kpi-foot">
            Derived from latest recorded attempt
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-top">
            Attempts
            <Repeat2 size={14} />
          </div>

          <div className="kpi-value">
            {attempts.length}
          </div>

          <div className="kpi-foot">
            Persisted attempts
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-top">
            Events
            <Radio size={14} />
          </div>

          <div className="kpi-value">
            {events.length}
          </div>

          <div className="kpi-foot">
            Persisted webhook events
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-top">
            Ledger effects
            <WalletCards size={14} />
          </div>

          <div className="kpi-value">
            {ledger.length}
          </div>

          <div className="kpi-foot">
            Financial effects committed
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <Panel
          title="Attempts"
          caption="Provider references and retry information"
        >
          <DataTable
            cols={[
              {
                name: 'Attempt',
                key: 'attempt_number',
                render: (r) =>
                  `#${r.attempt_number}`,
              },
              {
                name: 'Status',
                key: 'status',
                render: (r) => (
                  <Badge value={r.status} />
                ),
              },
              {
                name: 'Provider ref',
                key: 'provider_reference',
              },
              {
                name: 'Error',
                key: 'error_code',
              },
              {
                name: 'Next retry',
                key: 'next_retry_at',
                render: (r) =>
                  fmtDate(r.next_retry_at),
              },
            ]}
            rows={attempts}
          />
        </Panel>

        <Panel
          title="Associated events"
          caption="Persisted webhook processing state"
        >
          <DataTable
            cols={[
              {
                name: 'Event ID',
                key: 'event_id',
                render: (r) => (
                  <span className="mono">
                    {r.event_id}
                  </span>
                ),
              },
              {
                name: 'Type',
                key: 'event_type',
              },
              {
                name: 'Provider',
                key: 'provider_status',
              },
              {
                name: 'Status',
                key: 'status',
                render: (r) => (
                  <Badge value={r.status} />
                ),
              },
              {
                name: 'Received',
                key: 'received_at',
                render: (r) =>
                  fmtDate(r.received_at),
              },
            ]}
            rows={events}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel
          title="Ledger effect"
          caption="Financial source of truth"
        >
          <DataTable
            cols={[
              {
                name: 'Entry type',
                key: 'entry_type',
              },
              {
                name: 'Amount / quantity',
                key: 'quantity',
              },
              {
                name: 'Asset',
                key: 'asset',
              },
              {
                name: 'Reference',
                key: 'reference_id',
              },
              {
                name: 'Created',
                key: 'created_at',
                render: (r) =>
                  fmtDate(r.created_at),
              },
            ]}
            rows={ledger}
          />
        </Panel>
      </div>
    </>
  )
}
