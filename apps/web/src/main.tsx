import { api, fileUrl, human } from "./lib/api";
import {
  Elapsed,
  TabLabel,
  Welcome,
  Missing,
  Overview,
  CodePanel,
  MarkdownPanel,
  HtmlPanel,
  ImagesPanel,
  LinksPanel,
  FormsPanel,
} from "./components/results";
import React, { useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  ConfigProvider,
  App as AntApp,
  Button,
  Input,
  Select,
  Segmented,
  Checkbox,
  Switch,
  InputNumber,
  Tabs,
  Tag,
  Tooltip,
  Alert,
  Empty,
  Skeleton,
  Spin,
  Progress,
  Table,
  Popconfirm,
  Collapse,
  Dropdown,
  Descriptions,
} from "antd";
import {
  ArrowRight,
  ArrowUpRight,
  Globe,
  Layers,
  History,
  Plus,
  ChevronDown,
  Download,
  Copy,
  FileText,
  Code2,
  Image as ImageIcon,
  Camera,
  Braces,
  Link as LinkIcon,
  ListChecks,
  LayoutGrid,
  Network,
  Search,
  X,
  Trash2,
  Monitor,
  Smartphone,
  Check,
  FolderOpen,
  LoaderCircle,
  Settings2,
  HardDrive,
  ExternalLink,
  Info,
  Square,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

import type { Job, Options, PageResult, ImageCandidate } from "@context/shared";
import "./style.css";

const defaults: Options = {
  mode: "auto",
  content: "main",
  outputs: ["markdown", "html", "images"],
  viewport: "desktop",
  fullPage: true,
  waitFor: "",
  delay: 500,
  scroll: true,
  fields: "",
  maxPages: 20,
  maxDepth: 2,
  include: "",
  exclude: "",
  sameOrigin: true,
};
const icons = {
  markdown: FileText,
  html: Code2,
  images: ImageIcon,
  screenshot: Camera,
  json: Braces,
};
const labels = {
  markdown: "Markdown",
  html: "HTML",
  images: "Images",
  screenshot: "Screenshot",
  json: "Structured JSON",
};
const active = (job?: Job) => job && ["queued", "running"].includes(job.status);
function statusColor(status: string) {
  return (
    {
      completed: "success",
      partial: "warning",
      failed: "error",
      running: "processing",
      queued: "default",
      cancelled: "default",
      interrupted: "warning",
    } as Record<string, string>
  )[status];
}

function Application() {
  const { message } = AntApp.useApp();
  const [history, setHistory] = useState<Job[]>([]),
    [job, setJob] = useState<Job>(),
    [url, setUrl] = useState(""),
    [options, setOptions] = useState<Options>(defaults);
  const [kind, setKind] = useState<Job["kind"]>("scrape"),
    [tab, setTab] = useState("overview"),
    [historySearch, setHistorySearch] = useState("");
  const [loading, setLoading] = useState(false),
    [opening, setOpening] = useState(false),
    [error, setError] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [showHistory, setShowHistory] = useState(false);
  const [pageIndex, setPageIndex] = useState(0),
    [selectedUrls, setSelectedUrls] = useState<React.Key[]>([]),
    [schemaText, setSchemaText] = useState("");
  const [health, setHealth] = useState<{
      aiConfigured: boolean;
      model: string;
      allowLocalTargets: boolean;
    }>(),
    [online, setOnline] = useState(true);
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<Job[]>("/jobs"));
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);
  useEffect(() => {
    void loadHistory();
    api<typeof health>("/health")
      .then(setHealth)
      .catch(() => setOnline(false));
  }, [loadHistory]);
  useEffect(() => {
    if (!active(job)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await api<Job>("/jobs/" + job!.id);
        if (stopped) return;
        setJob(next);
        setOnline(true);
        if (!active(next)) void loadHistory();
        else timer = setTimeout(tick, 850);
      } catch {
        if (!stopped) {
          setOnline(false);
          timer = setTimeout(tick, 2500);
        }
      }
    };
    timer = setTimeout(tick, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, loadHistory]);
  const notifyError = (e: unknown) => {
    void message.error(e instanceof Error ? e.message : "Something went wrong");
  };
  const update = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));
  const run = async (overrideKind?: Job["kind"], urls?: string[]) => {
    setError("");
    let schema: Record<string, unknown> | undefined;
    try {
      if (schemaText.trim()) schema = JSON.parse(schemaText);
      if (schema && (typeof schema !== "object" || Array.isArray(schema)))
        throw new Error("Schema must be a JSON object.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON Schema");
      return;
    }
    if (!url.trim()) {
      setError("Enter the HTTP or HTTPS URL you want to extract.");
      return;
    }
    setLoading(true);
    try {
      const created = await api<Job>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          kind: overrideKind || kind,
          options: { ...options, schema },
          urls,
        }),
      });
      setJob(created);
      setPageIndex(0);
      setSelectedUrls([]);
      setTab("overview");
      setShowHistory(false);
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start extraction");
    } finally {
      setLoading(false);
    }
  };
  const open = async (item: Job) => {
    setOpening(true);
    setError("");
    try {
      const next = await api<Job>("/jobs/" + item.id);
      setJob(next);
      setUrl(next.url);
      setOptions(next.options);
      setSchemaText(
        next.options.schema ? JSON.stringify(next.options.schema, null, 2) : "",
      );
      setKind(next.kind);
      setPageIndex(0);
      setTab("overview");
      setShowHistory(false);
    } catch (e) {
      notifyError(e);
    } finally {
      setOpening(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api("/jobs/" + id, { method: "DELETE" });
      if (job?.id === id) setJob(undefined);
      void loadHistory();
      void message.success("Extraction deleted");
    } catch (e) {
      notifyError(e);
    }
  };
  const fresh = () => {
    setJob(undefined);
    setUrl("");
    setError("");
    setTab("overview");
    setPageIndex(0);
    setShowHistory(false);
  };
  const pages = job?.result ? [job.result] : job?.pages || [],
    page = pages[pageIndex];
  const busy = !!active(job),
    hasResult = !!page;
  const exportLink = (format: string) =>
    `/api/jobs/${job?.id}/export?format=${format}&page=${pageIndex}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      void message.success("Copied to clipboard");
    } catch {
      void message.error("Clipboard unavailable. Use the download action.");
    }
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={fresh}>
          <span className="brand-symbol">
            <img src="/favicon.svg" width="18" height="18" alt="" />
          </span>
          <span>
            Context<span className="brand-local">Local</span>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">U</span>
          <div>
            Personal workspace<small>On your machine</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <div className="nav-group-label">WORKSPACE</div>
        <button
          className={`nav-item ${!showHistory ? "selected" : ""}`}
          onClick={() => setShowHistory(false)}
        >
          <LayoutGrid size={16} /> Extraction studio
        </button>
        <button
          className={`nav-item ${showHistory ? "selected" : ""}`}
          onClick={() => {
            setShowHistory(true);
            void loadHistory();
          }}
        >
          <History size={16} /> History{" "}
          <span className="nav-count">{history.length}</span>
        </button>
        <div className="history-heading">
          <span>Recent extractions</span>
          <Tooltip title="New extraction">
            <button className="icon-button" onClick={fresh}>
              <Plus size={15} />
            </button>
          </Tooltip>
        </div>
        <div className="recent-list">
          {history.slice(0, 10).map((item) => (
            <button
              key={item.id}
              className={`recent-item ${job?.id === item.id ? "current" : ""}`}
              onClick={() => void open(item)}
            >
              <Globe size={14} />
              <span>
                {new URL(item.url).hostname}
                <small>
                  {new Date(item.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <span className={`status-dot ${item.status}`} />
            </button>
          ))}
          {!history.length && (
            <p className="sidebar-empty">Your extractions will appear here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <HardDrive size={15} />
            <span>
              Local storage<small>Saved only on this device</small>
            </span>
            <span className={`connection-dot ${online ? "" : "offline"}`} />
          </div>
          <div className="sidebar-footer">Your content. Your workspace.</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            {showHistory ? "History" : "Extraction studio"}
          </div>
          <div className="topbar-right">
            <span className={`connection-dot ${online ? "" : "offline"}`} />
            {online ? "Local instance" : "Reconnecting"}
            <span className="keyboard-hint">PERSONAL</span>
          </div>
        </header>
        <main>
          {!online && (
            <Alert
              type="warning"
              showIcon
              message="Connection lost"
              description="Reconnecting to your local server. Your persisted extractions are safe."
              className="mb"
            />
          )}
          {showHistory ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR WORKSPACE</div>
                  <h1>Extraction history</h1>
                  <p>
                    Pick up where you left off. All results stay on your
                    machine.
                  </p>
                </div>
                <Button
                  type="primary"
                  icon={<Plus size={15} />}
                  onClick={fresh}
                >
                  New extraction
                </Button>
              </div>
              <div className="panel history-panel">
                <Input
                  prefix={<Search size={15} />}
                  placeholder="Search by URL"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  allowClear
                />
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={history.filter((j) =>
                    j.url.toLowerCase().includes(historySearch.toLowerCase()),
                  )}
                  columns={[
                    {
                      title: "URL",
                      dataIndex: "url",
                      render: (value: string, item: Job) => (
                        <button
                          className="table-link"
                          onClick={() => void open(item)}
                        >
                          {value}
                        </button>
                      ),
                    },
                    { title: "Type", dataIndex: "kind", render: human },
                    {
                      title: "Status",
                      dataIndex: "status",
                      render: (s: string) => (
                        <Tag color={statusColor(s)}>{human(s)}</Tag>
                      ),
                    },
                    {
                      title: "Created",
                      dataIndex: "createdAt",
                      render: (s: string) => new Date(s).toLocaleString(),
                    },
                    {
                      title: "",
                      render: (_: unknown, item: Job) => (
                        <Popconfirm
                          title="Delete this extraction and its files?"
                          onConfirm={() => void remove(item.id)}
                        >
                          <Button
                            danger
                            type="text"
                            disabled={!!active(item)}
                            icon={<Trash2 size={15} />}
                            aria-label="Delete extraction"
                          />
                        </Popconfirm>
                      ),
                    },
                  ]}
                  locale={{
                    emptyText: <Empty description="No extractions yet" />,
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>Extraction studio</h1>
                  <p>Scrape a page, collect its assets, or map a website.</p>
                </div>
              </div>
              <section className="capture-panel panel">
                <div className="capture-top">
                  <Segmented
                    value={kind}
                    onChange={(v) => setKind(v as Job["kind"])}
                    options={[
                      {
                        value: "scrape",
                        label: (
                          <span>
                            <Code2 size={14} /> Scrape page
                          </span>
                        ),
                      },
                      {
                        value: "map",
                        label: (
                          <span>
                            <Network size={14} /> Map URLs
                          </span>
                        ),
                      },
                      {
                        value: "crawl",
                        label: (
                          <span>
                            <Layers size={14} /> Crawl site
                          </span>
                        ),
                      },
                    ]}
                  />
                  <Tooltip title="Keys stay on the server. HTML and Markdown previews are sanitized.">
                    <span className="capture-note">
                      <Info size={13} /> Personal extraction studio
                    </span>
                  </Tooltip>
                </div>
                <form
                  className="url-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run();
                  }}
                >
                  <Globe size={19} />
                  <Input
                    aria-label="Page URL"
                    placeholder="https://example.com — paste a URL to get started"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    variant="borderless"
                    size="large"
                    disabled={busy}
                  />
                  <Button
                    type="primary"
                    htmlType="submit"
                    aria-label={
                      kind === "map"
                        ? "Discover URLs"
                        : kind === "crawl"
                          ? "Start crawl"
                          : "Extract page"
                    }
                    loading={loading}
                    disabled={busy}
                    icon={<ArrowRight size={16} />}
                    iconPosition="end"
                  >
                    {kind === "map"
                      ? "Discover URLs"
                      : kind === "crawl"
                        ? "Start crawl"
                        : "Extract page"}
                  </Button>
                </form>
                <div className="capture-bottom">
                  <div className="mode-control">
                    <span>Capture</span>
                    <Segmented
                      size="small"
                      value={options.mode}
                      onChange={(v) => {
                        setOptions((o) => ({
                          ...o,
                          mode: v as Options["mode"],
                          outputs:
                            v === "http"
                              ? o.outputs.filter((x) => x !== "screenshot")
                              : o.outputs,
                          waitFor: v === "http" ? "" : o.waitFor,
                        }));
                      }}
                      options={["auto", "http", "browser"].map((v) => ({
                        value: v,
                        label: human(v),
                      }))}
                    />
                  </div>
                  <button
                    className={`text-button ${advanced ? "blue" : ""}`}
                    onClick={() => setAdvanced(!advanced)}
                  >
                    <Settings2 size={14} /> Extraction options{" "}
                    <ChevronDown
                      size={13}
                      className={advanced ? "rotate" : ""}
                    />
                  </button>
                </div>
                <div className="output-row">
                  <span className="option-caption">OUTPUTS</span>
                  {(Object.keys(icons) as (keyof typeof icons)[]).map((key) => {
                    const Icon = icons[key],
                      disabled =
                        key === "screenshot" && options.mode === "http";
                    return (
                      <Tooltip
                        key={key}
                        title={
                          disabled
                            ? "Screenshots require Auto or Browser mode"
                            : key === "json" && !health?.aiConfigured
                              ? "Configure OPENAI_API_KEY to enable AI extraction"
                              : undefined
                        }
                      >
                        <label
                          className={`output-chip ${options.outputs.includes(key) ? "checked" : ""} ${disabled ? "disabled" : ""}`}
                        >
                          <Checkbox
                            checked={options.outputs.includes(key)}
                            disabled={disabled}
                            onChange={(e) =>
                              update(
                                "outputs",
                                e.target.checked
                                  ? [...options.outputs, key]
                                  : options.outputs.filter((x) => x !== key),
                              )
                            }
                          />
                          <Icon size={14} />
                          {labels[key]}
                        </label>
                      </Tooltip>
                    );
                  })}
                </div>
                {advanced && (
                  <div className="advanced-panel">
                    <div className="options-grid">
                      <label>
                        Content mode
                        <Select
                          value={options.content}
                          onChange={(v) => update("content", v)}
                          options={[
                            {
                              value: "main",
                              label: "Main content · Readability",
                            },
                            {
                              value: "full",
                              label: "Full page · includes app content",
                            },
                          ]}
                        />
                        <small>
                          Forms and links are always extracted separately.
                        </small>
                      </label>
                      <label>
                        Viewport
                        <Select
                          disabled={options.mode === "http"}
                          value={options.viewport}
                          onChange={(v) => update("viewport", v)}
                          options={[
                            {
                              value: "desktop",
                              label: "Desktop · 1440 × 1000",
                            },
                            { value: "mobile", label: "Mobile · 390 × 664" },
                          ]}
                        />
                      </label>
                      <label>
                        Wait for selector
                        <Input
                          disabled={options.mode === "http"}
                          value={options.waitFor}
                          placeholder="e.g. main, .article"
                          onChange={(e) => update("waitFor", e.target.value)}
                        />
                      </label>
                      <label>
                        Delay after load (ms)
                        <InputNumber
                          disabled={options.mode === "http"}
                          min={0}
                          max={5000}
                          step={100}
                          value={options.delay}
                          onChange={(v) => update("delay", v ?? 0)}
                        />
                      </label>
                    </div>
                    <div className="switch-row">
                      <label>
                        <Switch
                          size="small"
                          disabled={options.mode === "http"}
                          checked={options.scroll}
                          onChange={(v) => update("scroll", v)}
                        />{" "}
                        Bounded lazy-load scrolling
                      </label>
                      <label>
                        <Switch
                          size="small"
                          disabled={options.mode === "http"}
                          checked={options.fullPage}
                          onChange={(v) => update("fullPage", v)}
                        />{" "}
                        Full-page screenshot
                      </label>
                      <span className="muted">
                        {options.mode === "http"
                          ? "Browser controls are unavailable in HTTP mode."
                          : "At most 6 scrolls · no network-idle dependency"}
                      </span>
                    </div>
                  </div>
                )}
                {kind !== "scrape" && (
                  <div className="advanced-panel">
                    <div className="options-grid crawl-options">
                      <label>
                        Maximum pages
                        <InputNumber
                          min={1}
                          max={100}
                          value={options.maxPages}
                          onChange={(v) => update("maxPages", v ?? 20)}
                        />
                      </label>
                      <label>
                        Link depth
                        <InputNumber
                          min={0}
                          max={5}
                          value={options.maxDepth}
                          onChange={(v) => update("maxDepth", v ?? 2)}
                        />
                      </label>
                      <label>
                        Include path contains
                        <Input
                          placeholder="/docs, /blog"
                          value={options.include}
                          onChange={(e) => update("include", e.target.value)}
                        />
                      </label>
                      <label>
                        Exclude path contains
                        <Input
                          placeholder="/login, /admin"
                          value={options.exclude}
                          onChange={(e) => update("exclude", e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="switch-row">
                      <label>
                        <Switch
                          size="small"
                          checked={options.sameOrigin}
                          onChange={(v) => update("sameOrigin", v)}
                        />{" "}
                        Stay on the same origin
                      </label>
                      <span className="muted">
                        Respects robots.txt · 2 concurrent pages · no retries
                      </span>
                    </div>
                  </div>
                )}
                {options.outputs.includes("json") && (
                  <div className="advanced-panel ai-options">
                    {!health?.aiConfigured && (
                      <Alert
                        type="info"
                        showIcon
                        message="Set OPENAI_API_KEY in .env and restart to enable structured extraction."
                      />
                    )}
                    <label>
                      What would you like to extract?
                      <Input.TextArea
                        rows={2}
                        value={options.fields}
                        onChange={(e) => update("fields", e.target.value)}
                        placeholder="Extract the product name, price, currency, and availability. Use null for missing fields."
                      />
                    </label>
                    <Collapse
                      ghost
                      size="small"
                      items={[
                        {
                          key: "schema",
                          label: "Optional JSON Schema",
                          children: (
                            <Input.TextArea
                              className="code-input"
                              rows={6}
                              value={schemaText}
                              onChange={(e) => setSchemaText(e.target.value)}
                              placeholder={
                                '{"type":"object","properties":{"name":{"type":["string","null"]}},"required":["name"]}'
                              }
                            />
                          ),
                        },
                      ]}
                    />
                    <small className="muted">
                      Cleaned page content is sent to{" "}
                      {health?.model || "your configured model"} only when this
                      output is selected.
                    </small>
                  </div>
                )}
              </section>
              {error && (
                <Alert
                  className="mt"
                  type="error"
                  showIcon
                  message="Could not start extraction"
                  description={error}
                  closable
                  onClose={() => setError("")}
                />
              )}
              <section className="results-section">
                <div className="section-heading">
                  <div>
                    <h2>{job ? "Extraction results" : "Getting started"}</h2>
                    {job ? (
                      <span className="muted">
                        {new Date(job.createdAt).toLocaleString()}{" "}
                        <span className="inline-separator">·</span>{" "}
                        {human(job.kind)}
                      </span>
                    ) : (
                      <span className="muted">
                        Select your outputs above, then run an extraction.
                      </span>
                    )}
                  </div>
                  {job && (
                    <div className="result-actions">
                      <Tag color={statusColor(job.status)}>
                        {busy ? <Spin size="small" /> : null}{" "}
                        {human(job.status)}
                      </Tag>
                      {busy ? (
                        <Button
                          danger
                          size="small"
                          icon={<Square size={12} />}
                          onClick={() =>
                            api<Job>("/jobs/" + job.id + "/cancel", {
                              method: "POST",
                            })
                              .then(setJob)
                              .catch(notifyError)
                          }
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: "zip",
                                label: "Download complete bundle",
                                icon: <FolderOpen size={14} />,
                              },
                              {
                                key: "json",
                                label: "Download result JSON",
                                icon: <Braces size={14} />,
                              },
                              {
                                key: "markdown",
                                label: "Download Markdown",
                                icon: <FileText size={14} />,
                              },
                            ],
                            onClick: ({ key }) =>
                              window.location.assign(exportLink(key)),
                          }}
                        >
                          <Button size="small" icon={<Download size={14} />}>
                            Export <ChevronDown size={12} />
                          </Button>
                        </Dropdown>
                      )}
                    </div>
                  )}
                </div>
                {opening ? (
                  <div className="panel result-skeleton">
                    <Skeleton active paragraph={{ rows: 7 }} />
                  </div>
                ) : busy ? (
                  <div className="panel running-panel">
                    <div className="running-title">
                      <div className="loading-icon">
                        <LoaderCircle size={21} />
                      </div>
                      <div>
                        <h3>
                          {job?.kind === "map"
                            ? "Discovering your site"
                            : "Collecting page content"}
                        </h3>
                        <p aria-live="polite">{job?.progress}</p>
                      </div>
                      <span className="elapsed">
                        <Elapsed started={job?.startedAt || job?.createdAt} />
                      </span>
                    </div>
                    <div
                      className="activity-track"
                      role="progressbar"
                      aria-label="Extraction in progress"
                    >
                      <span />
                    </div>
                    <div className="loading-steps">
                      {["Fetch", "Render", "Extract", "Save"].map((s, i) => (
                        <span
                          key={s}
                          className={
                            job?.progress
                              .toLowerCase()
                              .includes(s.toLowerCase())
                              ? "current"
                              : ""
                          }
                        >
                          <span>{i + 1}</span>
                          {s}
                        </span>
                      ))}
                    </div>
                    <div className="skeleton-columns">
                      <Skeleton
                        active
                        title={{ width: "45%" }}
                        paragraph={{ rows: 5 }}
                      />
                      <div className="skeleton-image">
                        <ImageIcon size={26} />
                        <Skeleton
                          active
                          paragraph={{ rows: 2 }}
                          title={false}
                        />
                      </div>
                    </div>
                    <p className="loading-hint">
                      You can leave this view. Results are saved automatically.
                    </p>
                  </div>
                ) : job?.status === "failed" ? (
                  <div className="panel error-panel">
                    <AlertCircle size={28} />
                    <h3>We couldn’t extract this page</h3>
                    <p>{job.error}</p>
                    <Button onClick={() => void run()}>Try again</Button>
                  </div>
                ) : job && !hasResult && job.kind !== "map" ? (
                  <div className="panel">
                    <Empty description={job.error || job.progress} />
                  </div>
                ) : !job ? (
                  <Welcome />
                ) : (
                  <>
                    {job.error && (
                      <Alert
                        type="warning"
                        showIcon
                        message={job.error}
                        className="mb"
                      />
                    )}
                    {job.discovered && (
                      <div className="panel discovery-panel">
                        <div className="discovery-header">
                          <div>
                            <Network size={16} />
                            <strong>
                              {job.discovered.length} discovered URLs
                            </strong>
                            <Tag>robots.txt respected</Tag>
                          </div>
                          <Button
                            type="primary"
                            size="small"
                            disabled={!selectedUrls.length}
                            icon={<ArrowRight size={14} />}
                            onClick={() =>
                              void run("crawl", selectedUrls.map(String))
                            }
                          >
                            Scrape selected ({selectedUrls.length})
                          </Button>
                        </div>
                        <Table
                          size="small"
                          rowKey="url"
                          rowSelection={{
                            selectedRowKeys: selectedUrls,
                            onChange: setSelectedUrls,
                          }}
                          dataSource={job.discovered}
                          pagination={{ pageSize: 10, size: "small" }}
                          columns={[
                            {
                              title: "URL",
                              dataIndex: "url",
                              ellipsis: true,
                              render: (value: string) => (
                                <a
                                  href={value}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {value}
                                </a>
                              ),
                            },
                            { title: "Depth", dataIndex: "depth", width: 70 },
                            {
                              title: "Source",
                              dataIndex: "source",
                              width: 130,
                            },
                            {
                              title: "Status",
                              render: (
                                _: unknown,
                                row: NonNullable<Job["discovered"]>[number],
                              ) =>
                                row.error ? (
                                  <Tooltip title={row.error}>
                                    <Tag color="error">Failed</Tag>
                                  </Tooltip>
                                ) : (
                                  <Tag>Discovered</Tag>
                                ),
                              width: 110,
                            },
                          ]}
                        />
                      </div>
                    )}
                    {page && (
                      <>
                        <div className="result-meta">
                          <span>
                            <CheckCircle2 size={14} />
                            {page.mode.toUpperCase()} capture
                          </span>
                          <span>{(page.durationMs / 1000).toFixed(1)}s</span>
                          <a
                            href={page.finalUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {page.finalUrl}
                            <ArrowUpRight size={13} />
                          </a>
                          {pages.length > 1 && (
                            <Select
                              size="small"
                              value={pageIndex}
                              onChange={setPageIndex}
                              options={pages.map((p, i) => ({
                                value: i,
                                label: p.title || p.finalUrl,
                              }))}
                            />
                          )}
                        </div>
                        {page.warnings.length > 0 && (
                          <Alert
                            type="warning"
                            showIcon
                            message={`Completed with ${page.warnings.length} ${page.warnings.length === 1 ? "notice" : "notices"}`}
                            description={
                              <ul className="warnings">
                                {page.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            }
                            className="mb"
                          />
                        )}
                        <div className="panel results-panel">
                          <Tabs
                            key={`${job.id}-${pageIndex}`}
                            activeKey={tab}
                            onChange={setTab}
                            items={[
                              {
                                key: "overview",
                                label: (
                                  <TabLabel icon={LayoutGrid} text="Overview" />
                                ),
                                children: <Overview page={page} />,
                              },
                              {
                                key: "markdown",
                                label: (
                                  <TabLabel icon={FileText} text="Markdown" />
                                ),
                                children: (
                                  <MarkdownPanel
                                    page={page}
                                    copy={copy}
                                    download={exportLink("markdown")}
                                  />
                                ),
                              },
                              {
                                key: "html",
                                label: <TabLabel icon={Code2} text="HTML" />,
                                children: (
                                  <HtmlPanel
                                    page={page}
                                    job={job}
                                    index={pageIndex}
                                    copy={copy}
                                  />
                                ),
                              },
                              {
                                key: "images",
                                label: (
                                  <TabLabel
                                    icon={ImageIcon}
                                    text="Images"
                                    count={page.images.length}
                                  />
                                ),
                                children: (
                                  <ImagesPanel
                                    page={page}
                                    job={job}
                                    onUpdate={setJob}
                                  />
                                ),
                              },
                              {
                                key: "screenshot",
                                label: (
                                  <TabLabel icon={Camera} text="Screenshot" />
                                ),
                                children: page.screenshot ? (
                                  <div className="screenshot-panel">
                                    <div className="pane-toolbar">
                                      <span>
                                        {job.options.viewport === "desktop" ? (
                                          <Monitor size={14} />
                                        ) : (
                                          <Smartphone size={14} />
                                        )}{" "}
                                        {human(job.options.viewport)} ·{" "}
                                        {job.options.fullPage
                                          ? "Full page"
                                          : "Viewport"}
                                      </span>
                                      <Button
                                        size="small"
                                        href={
                                          fileUrl(job.id, page.screenshot) +
                                          "?download=1"
                                        }
                                        icon={<Download size={14} />}
                                      >
                                        Download PNG
                                      </Button>
                                    </div>
                                    <div className="screenshot-frame">
                                      <img
                                        src={fileUrl(job.id, page.screenshot)}
                                        alt="Captured page screenshot"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <Missing
                                    title="No screenshot captured"
                                    text={
                                      job.options.mode === "http"
                                        ? "Choose Auto or Browser mode and enable Screenshot."
                                        : "Enable Screenshot in outputs before running extraction."
                                    }
                                  />
                                ),
                              },
                              {
                                key: "json",
                                label: <TabLabel icon={Braces} text="JSON" />,
                                children: page.structured ? (
                                  <CodePanel
                                    value={JSON.stringify(
                                      page.structured,
                                      null,
                                      2,
                                    )}
                                    copy={copy}
                                    download={exportLink("json")}
                                    label="Structured extraction · validated against your schema"
                                  />
                                ) : (
                                  <Missing
                                    title="No structured JSON"
                                    text={
                                      page.warnings.find((w) =>
                                        /model|JSON|API_KEY|Structured/.test(w),
                                      ) ||
                                      "Describe your fields and select Structured JSON to extract data with your configured model."
                                    }
                                  />
                                ),
                              },
                              {
                                key: "links",
                                label: (
                                  <TabLabel
                                    icon={LinkIcon}
                                    text="Links"
                                    count={page.links.length}
                                  />
                                ),
                                children: <LinksPanel page={page} />,
                              },
                              {
                                key: "forms",
                                label: (
                                  <TabLabel
                                    icon={ListChecks}
                                    text="Forms"
                                    count={page.forms.length}
                                  />
                                ),
                                children: <FormsPanel page={page} />,
                              },
                            ]}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
              </section>
              <footer className="main-footer">
                <span>
                  <HardDrive size={12} /> Stored locally. No account required.
                </span>
                <span>
                  Context Local <span className="footer-divider">/</span>{" "}
                  Personal web extraction
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#2a63ee",
          colorPrimaryBg: "#f1f1f1",
          colorPrimaryBgHover: "#e9e9e9",
          colorPrimaryBorder: "#cfcfcf",
          colorPrimaryBorderHover: "#b0b0b0",
          colorText: "#262b33",
          colorTextSecondary: "#7d838d",
          colorBorder: "#e2e2e2",
          colorBgLayout: "#fafafa",
          colorInfo: "#747474",
          colorInfoBg: "#f8f8f8",
          colorInfoBorder: "#e4e4e4",
          borderRadius: 8,
          fontSize: 12,
          controlOutline: "rgba(0,0,0,0.055)",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          controlHeight: 30,
        },
        components: {
          Button: {
            primaryShadow: "none",
            defaultHoverBg: "#f6f6f6",
            defaultHoverColor: "#262626",
            defaultHoverBorderColor: "#c6c6c6",
          },
          Input: {
            activeBorderColor: "#adadad",
            hoverBorderColor: "#c7c7c7",
            activeShadow: "0 0 0 3px rgba(0,0,0,.045)",
          },
          InputNumber: {
            activeBorderColor: "#adadad",
            hoverBorderColor: "#c7c7c7",
            activeShadow: "0 0 0 3px rgba(0,0,0,.045)",
          },
          Select: {
            activeBorderColor: "#adadad",
            hoverBorderColor: "#c7c7c7",
            activeOutlineColor: "rgba(0,0,0,.045)",
            optionSelectedBg: "#ededed",
            optionSelectedColor: "#242424",
            optionSelectedFontWeight: 400,
          },
          Checkbox: { colorPrimary: "#606060", colorPrimaryHover: "#454545" },
          Switch: { colorPrimary: "#646464", colorPrimaryHover: "#4f4f4f" },
          Tabs: {
            horizontalItemGutter: 20,
            itemSelectedColor: "#242424",
            itemActiveColor: "#242424",
            itemHoverColor: "#242424",
            inkBarColor: "#676767",
          },
          Table: { headerBg: "#fafbfc", cellPaddingBlockSM: 11 },
          Segmented: {
            trackBg: "#f5f5f5",
            itemSelectedBg: "#fff",
            itemColor: "#717171",
            itemSelectedColor: "#242424",
            itemHoverBg: "#ededed",
            itemHoverColor: "#242424",
          },
        },
      }}
    >
      <AntApp>
        <Application />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
