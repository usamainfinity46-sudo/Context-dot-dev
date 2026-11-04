import React, { useState, useEffect, useRef } from "react";
import {
  App as AntApp,
  Button,
  Input,
  Select,
  Segmented,
  Checkbox,
  InputNumber,
  Tag,
  Tooltip,
  Alert,
  Empty,
  Skeleton,
  Spin,
  Table,
  Collapse,
  Descriptions,
} from "antd";
import {
  Globe,
  Download,
  Copy,
  FileText,
  Code2,
  Image as ImageIcon,
  Braces,
  Search,
  Check,
  HardDrive,
  ExternalLink,
  Info,
  AlertCircle,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Job, PageResult, ImageCandidate } from "@context/shared";
import { api, fileUrl, human } from "../lib/api";
export function Elapsed({ started }: { started?: string }) {
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      {started
        ? Math.max(0, Math.floor((time - new Date(started).getTime()) / 1000))
        : 0}
      s elapsed
    </>
  );
}
export function TabLabel({
  icon: Icon,
  text,
  count,
}: {
  icon: typeof Globe;
  text: string;
  count?: number;
}) {
  return (
    <span className="tab-label">
      <Icon size={14} />
      {text}
      {count !== undefined && <span className="tab-count">{count}</span>}
    </span>
  );
}
export function Welcome() {
  return (
    <div className="welcome-grid">
      <section className="panel guide-panel">
        <div className="guide-heading">
          <FileText size={14} />
          <h3>Page outputs</h3>
          <span>Choose what you need</span>
        </div>
        {[
          {
            Icon: Code2,
            title: "Content",
            text: "Readable Markdown and original HTML.",
          },
          {
            Icon: ImageIcon,
            title: "Assets",
            text: "Image candidates, responsive variants, and screenshots.",
          },
          {
            Icon: Braces,
            title: "Structured data",
            text: "Describe your fields and extract validated JSON.",
          },
        ].map(({ Icon, title, text }) => (
          <div className="guide-row" key={title}>
            <span className="guide-icon">
              <Icon size={14} />
            </span>
            <div>
              <h4>{title}</h4>
              <p>{text}</p>
            </div>
          </div>
        ))}
        <div className="guide-foot">
          <HardDrive size={12} /> Results and files are saved on this device.
        </div>
      </section>
      <section className="panel guide-panel">
        <div className="guide-heading">
          <Globe size={14} />
          <h3>Capture guide</h3>
          <span>Three capture modes</span>
        </div>
        {[
          {
            name: "Auto",
            text: "Fetch HTTP first. Render JavaScript shells when needed.",
          },
          { name: "HTTP", text: "Fast response capture for static pages." },
          {
            name: "Browser",
            text: "Chromium rendering, lazy images, and screenshots.",
          },
        ].map(({ name, text }) => (
          <div className="guide-row mode-guide-row" key={name}>
            <span className="guide-mode">{name}</span>
            <p>{text}</p>
          </div>
        ))}
        <div className="guide-foot">
          <Info size={12} /> Screenshots always require a browser capture.
        </div>
      </section>
    </div>
  );
}
export function Missing({ title, text }: { title: string; text: string }) {
  return (
    <div className="missing">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <>
            <h3>{title}</h3>
            <p>{text}</p>
          </>
        }
      />
    </div>
  );
}
export function Overview({ page }: { page: PageResult }) {
  return (
    <div className="overview">
      <div className="overview-title">
        <span className="site-icon">
          <Globe size={20} />
        </span>
        <div>
          <h2>{page.title || "Untitled page"}</h2>
          <p>
            {page.description || "This page does not specify a description."}
          </p>
        </div>
      </div>
      <div className="counts-row">
        {[
          ["Headings", page.headings.length],
          ["Links", page.links.length],
          ["Image candidates", page.images.length],
          ["Forms", page.forms.length],
        ].map(([title, count]) => (
          <div key={title}>
            <span>{title}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <div>
          <h4>PAGE DETAILS</h4>
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: "mode", label: "Capture mode", children: page.modeReason },
              {
                key: "canonical",
                label: "Canonical URL",
                children: <span className="break-all">{page.canonical}</span>,
              },
              {
                key: "language",
                label: "Language",
                children: page.language || "Not specified",
              },
              {
                key: "time",
                label: "Captured",
                children: new Date(page.capturedAt).toLocaleString(),
              },
            ]}
          />
          {Object.keys(page.openGraph).length > 0 && (
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: "og",
                  label: `Open Graph & social metadata (${Object.keys(page.openGraph).length})`,
                  children: (
                    <pre className="code compact-code">
                      {JSON.stringify(page.openGraph, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          )}
        </div>
        <div>
          <h4>DOCUMENT OUTLINE</h4>
          {page.headings.length ? (
            <div className="outline">
              {page.headings.slice(0, 30).map((h, i) => (
                <div key={i} style={{ paddingLeft: (h.level - 1) * 10 }}>
                  <span>H{h.level}</span>
                  {h.text || "(empty heading)"}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No headings found on this page.</p>
          )}
        </div>
      </div>
    </div>
  );
}
export function CodePanel({
  value,
  copy,
  download,
  label,
}: {
  value: string;
  copy: (s: string) => void;
  download?: string;
  label: string;
}) {
  return (
    <div>
      <div className="pane-toolbar">
        <span>{label}</span>
        <div>
          <Button
            size="small"
            type="text"
            icon={<Copy size={13} />}
            onClick={() => copy(value)}
          >
            Copy
          </Button>
          {download && (
            <Button size="small" icon={<Download size={13} />} href={download}>
              Download
            </Button>
          )}
        </div>
      </div>
      <pre className="code">{value}</pre>
    </div>
  );
}
export function MarkdownPanel({
  page,
  copy,
  download,
}: {
  page: PageResult;
  copy: (s: string) => void;
  download: string;
}) {
  const [view, setView] = useState("preview");
  if (!page.markdown)
    return (
      <Missing
        title="No Markdown captured"
        text="Enable Markdown in outputs and run extraction."
      />
    );
  const html = DOMPurify.sanitize(
    marked.parse(page.markdown, { async: false }) as string,
    {
      FORBID_TAGS: [
        "img",
        "svg",
        "iframe",
        "form",
        "input",
        "style",
        "script",
        "video",
        "audio",
      ],
      FORBID_ATTR: ["style"],
    },
  );
  return (
    <div>
      <div className="pane-toolbar">
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(String(v))}
          options={[
            { value: "preview", label: "Preview" },
            { value: "source", label: "Source" },
          ]}
        />
        <div>
          <Button
            size="small"
            type="text"
            icon={<Copy size={13} />}
            onClick={() => copy(page.markdown)}
          >
            Copy
          </Button>
          <Button size="small" href={download} icon={<Download size={13} />}>
            Download .md
          </Button>
        </div>
      </div>
      {view === "preview" ? (
        <article
          className="markdown-preview"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="code">{page.markdown}</pre>
      )}
    </div>
  );
}
export function HtmlPanel({
  page,
  job,
  index,
  copy,
}: {
  page: PageResult;
  job: Job;
  index: number;
  copy: (s: string) => void;
}) {
  const [view, setView] = useState("raw");
  const html = view === "raw" ? page.rawHtml : page.renderedHtml;
  return (
    <div>
      <div className="pane-toolbar">
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(String(v))}
          options={[
            { value: "raw", label: "Raw response HTML" },
            {
              value: "rendered",
              label: "Rendered HTML",
              disabled: page.mode === "http",
            },
          ]}
        />
        <span className="muted">Escaped source · never executed</span>
      </div>
      {html ? (
        <CodePanel
          value={html}
          label={`${(new Blob([html]).size / 1024).toFixed(1)} KB · ${view === "raw" ? "HTTP response body" : "DOM after JavaScript"}`}
          copy={copy}
          download={`/api/jobs/${job.id}/export?format=${view}&page=${index}`}
        />
      ) : (
        <Missing
          title="No HTML captured"
          text={
            view === "rendered"
              ? "Rendered HTML is available in Browser mode."
              : "Enable HTML in outputs to keep the response source."
          }
        />
      )}
    </div>
  );
}

export function ImagesPanel({
  page,
  job,
  onUpdate,
}: {
  page: PageResult;
  job: Job;
  onUpdate: (j: Job) => void;
}) {
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  const refresh = () => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void api<Job>("/jobs/" + job.id)
        .then(onUpdate)
        .catch(() => {});
    }, 350);
  };
  const { message } = AntApp.useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [minWidth, setMinWidth] = useState(0),
    [minHeight, setMinHeight] = useState(0),
    [type, setType] = useState("all"),
    [busy, setBusy] = useState(false),
    [failedOnly, setFailedOnly] = useState(false);
  const images = page.images.filter(
    (i) =>
      (!minWidth || (i.width || 0) >= minWidth) &&
      (!minHeight || (i.height || 0) >= minHeight) &&
      (type === "all" || i.types.includes(type)) &&
      (!failedOnly || i.status === "failed"),
  );
  const download = async (ids: string[], zip = false) => {
    setBusy(true);
    try {
      const next = await api<Job>(`/jobs/${job.id}/images/download`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      onUpdate(next);
      const all = next.result ? [next.result] : next.pages || [];
      const failed = all
        .flatMap((p) => p.images)
        .filter((i) => ids.includes(i.id) && i.status === "failed");
      if (failed.length)
        void message.warning(
          `${failed.length} image download${failed.length === 1 ? "" : "s"} failed. Details are shown in the gallery.`,
        );
      else
        void message.success(
          `${ids.length} image${ids.length === 1 ? "" : "s"} saved locally`,
        );
      if (zip)
        window.location.assign(
          `/api/jobs/${job.id}/export?format=images&ids=${ids.join(",")}`,
        );
      else if (ids.length === 1) {
        const image = all.flatMap((p) => p.images).find((i) => i.id === ids[0]);
        if (image?.file)
          window.location.assign(fileUrl(job.id, image.file) + "?download=1");
      }
    } catch (e) {
      void message.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };
  if (!page.images.length)
    return (
      <Missing
        title="No image candidates"
        text="Enable Images in outputs, or try Browser mode for dynamically loaded images."
      />
    );
  return (
    <div className="images-panel">
      <div className="image-filters">
        <Select
          size="small"
          aria-label="Image source type"
          value={type}
          onChange={setType}
          options={["all", ...new Set(page.images.flatMap((i) => i.types))].map(
            (v) => ({ value: v, label: v === "all" ? "All source types" : v }),
          )}
        />
        <span className="muted">Min. size</span>
        <InputNumber
          size="small"
          min={0}
          value={minWidth}
          onChange={(v) => setMinWidth(v ?? 0)}
          addonAfter="w"
          aria-label="Minimum width"
        />
        <span className="muted">×</span>
        <InputNumber
          size="small"
          min={0}
          value={minHeight}
          onChange={(v) => setMinHeight(v ?? 0)}
          addonAfter="h"
          aria-label="Minimum height"
        />
        <Checkbox
          checked={failedOnly}
          onChange={(e) => setFailedOnly(e.target.checked)}
        >
          Failures only
        </Checkbox>
        <span className="image-count">
          {images.length} of {page.images.length} candidates
        </span>
      </div>
      <div className="pane-toolbar">
        <Checkbox
          checked={images.length > 0 && images.every((i) => selected.has(i.id))}
          indeterminate={
            images.some((i) => selected.has(i.id)) &&
            !images.every((i) => selected.has(i.id))
          }
          onChange={(e) =>
            setSelected(
              e.target.checked ? new Set(images.map((i) => i.id)) : new Set(),
            )
          }
        >
          Select visible
        </Checkbox>
        <div>
          <Button
            size="small"
            disabled={!selected.size || busy}
            loading={busy}
            icon={<Download size={13} />}
            onClick={() => void download([...selected], true)}
          >
            Selected ZIP ({selected.size})
          </Button>
          <Button
            size="small"
            disabled={busy}
            loading={busy}
            onClick={() =>
              void download(
                page.images.map((i) => i.id),
                true,
              )
            }
          >
            Download all ZIP
          </Button>
        </div>
      </div>
      {busy && (
        <div className="image-download-progress">
          <Spin size="small" />
          <span>
            Downloading images in small batches. Failed images won’t stop the
            rest.
          </span>
        </div>
      )}
      <div className="image-grid">
        {images.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            jobId={job.id}
            checked={selected.has(image.id)}
            onSelect={(checked) =>
              setSelected((old) => {
                const next = new Set(old);
                checked ? next.add(image.id) : next.delete(image.id);
                return next;
              })
            }
            onDownload={() => void download([image.id])}
            busy={busy}
            onSettled={refresh}
          />
        ))}
      </div>
      {!images.length && (
        <Missing
          title="No images match your filters"
          text="Try a smaller minimum size or a different source type. Unknown dimensions are excluded when a minimum is set."
        />
      )}
      <p className="gallery-note">
        Candidates are discovered sources, not guaranteed downloads. Responsive
        URLs keep their query parameters. Previews are fetched through your
        server. SVG files are available as downloads only.
      </p>
    </div>
  );
}
function ImageCard({
  image,
  jobId,
  checked,
  onSelect,
  onDownload,
  busy,
  onSettled,
}: {
  image: ImageCandidate;
  jobId: string;
  checked: boolean;
  onSelect: (v: boolean) => void;
  onDownload: () => void;
  busy: boolean;
  onSettled: () => void;
}) {
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(false);
  const svg =
    image.types.includes("inline-svg") ||
    image.mime === "image/svg+xml" ||
    /\.svg(?:\?|$)|^data:image\/svg/i.test(image.url);
  return (
    <div className={`image-card ${checked ? "is-selected" : ""}`}>
      <div className="image-preview">
        <Checkbox
          checked={checked}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label="Select image"
        />
        {!svg ? (
          <>
            {!loaded && !error && <Skeleton.Image active />}
            {!error ? (
              <img
                loading="lazy"
                src={
                  image.file
                    ? fileUrl(jobId, image.file)
                    : `/api/jobs/${jobId}/images/${image.id}/preview`
                }
                onLoad={() => {
                  setLoaded(true);
                  onSettled();
                }}
                onError={() => {
                  setError(true);
                  onSettled();
                }}
                alt={image.alt || "Extracted image"}
                style={{ opacity: loaded ? 1 : 0 }}
              />
            ) : (
              <div className="image-placeholder">
                <ImageIcon size={25} />
                <span>Preview unavailable</span>
              </div>
            )}
          </>
        ) : (
          <div className="image-placeholder">
            <ImageIcon size={25} />
            <span>
              {svg ? "SVG · download only" : "Preview after download"}
            </span>
            {!svg && image.status !== "failed" && (
              <Button
                size="small"
                type="link"
                disabled={busy}
                onClick={onDownload}
              >
                Load image
              </Button>
            )}
          </div>
        )}
        <span className="dimension-badge">
          {image.width || "?"} × {image.height || "?"}
        </span>
      </div>
      <div className="image-info">
        <Tooltip
          title={
            image.url.startsWith("data:") ? "Embedded image data" : image.url
          }
        >
          <div className="image-url">
            {image.url.startsWith("data:") ? "Embedded image data" : image.url}
          </div>
        </Tooltip>
        <p>{image.alt || "No alt text"}</p>
        <div className="image-tags">
          {image.types.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
        {image.error && (
          <div className="image-error">
            <AlertCircle size={12} />
            {image.error}
          </div>
        )}
        <div className="image-card-footer">
          <span className={"download-status " + image.status}>
            {image.status === "downloaded" ? (
              <>
                <Check size={12} /> Saved
              </>
            ) : image.status === "failed" ? (
              "Download failed"
            ) : (
              "Candidate"
            )}
          </span>
          {image.file ? (
            <Tooltip title="Download image">
              <Button
                size="small"
                type="text"
                icon={<Download size={14} />}
                href={fileUrl(jobId, image.file) + "?download=1"}
                aria-label="Download image"
              />
            </Tooltip>
          ) : (
            <Button
              size="small"
              type="text"
              loading={busy}
              icon={<Download size={14} />}
              onClick={onDownload}
              aria-label="Download image"
            />
          )}
        </div>
      </div>
    </div>
  );
}
export function LinksPanel({ page }: { page: PageResult }) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  return (
    <div>
      <div className="pane-toolbar">
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(String(v))}
          options={["all", "internal", "external"].map((v) => ({
            value: v,
            label: human(v),
          }))}
        />
        <Input
          size="small"
          prefix={<Search size={13} />}
          placeholder="Filter URLs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 230 }}
          allowClear
        />
      </div>
      <Table
        size="small"
        rowKey="url"
        pagination={{ pageSize: 15, size: "small" }}
        dataSource={page.links.filter(
          (l) =>
            (filter === "all" || l.internal === (filter === "internal")) &&
            (l.url + " " + l.text).toLowerCase().includes(search.toLowerCase()),
        )}
        columns={[
          {
            title: "Link text",
            dataIndex: "text",
            width: "30%",
            render: (text: string) =>
              text || <span className="muted">No text</span>,
          },
          {
            title: "URL",
            dataIndex: "url",
            ellipsis: true,
            render: (url: string) => (
              <a href={url} target="_blank" rel="noreferrer">
                {url} <ExternalLink size={11} />
              </a>
            ),
          },
          {
            title: "Type",
            dataIndex: "internal",
            width: 90,
            render: (v: boolean) => <Tag>{v ? "Internal" : "External"}</Tag>,
          },
        ]}
      />
    </div>
  );
}
export function FormsPanel({ page }: { page: PageResult }) {
  if (!page.forms.length)
    return (
      <Missing
        title="No forms found"
        text="This page has no form elements. Browser mode can reveal forms added by JavaScript."
      />
    );
  return (
    <div className="forms-panel">
      <Alert
        type="info"
        showIcon
        message="Form structure only. Entered field values are never extracted into this view."
      />
      {page.forms.map((form, index) => (
        <div className="form-section" key={index}>
          <h3>
            <Tag>{form.method}</Tag> Form {index + 1}
            <span>{form.action}</span>
          </h3>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            pagination={false}
            dataSource={form.fields}
            columns={[
              {
                title: "Label",
                dataIndex: "label",
                render: (v: string) => v || "—",
              },
              {
                title: "Name",
                dataIndex: "name",
                render: (v: string) => <code>{v || "—"}</code>,
              },
              { title: "Type", dataIndex: "type" },
              { title: "Placeholder", dataIndex: "placeholder" },
              {
                title: "Required",
                dataIndex: "required",
                render: (v: boolean) =>
                  v ? <Check size={14} /> : <span className="muted">—</span>,
              },
              {
                title: "Options",
                dataIndex: "options",
                render: (v: { text: string; value: string }[] | undefined) =>
                  v ? (
                    <Tooltip
                      title={v.map((o) => `${o.text} (${o.value})`).join(", ")}
                    >
                      <span>{v.length} options</span>
                    </Tooltip>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </div>
      ))}
    </div>
  );
}
