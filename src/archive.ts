import { realpath, readFile, stat } from "node:fs/promises";
import { resolve, relative, extname, sep, isAbsolute } from "node:path";

// Archive-owned domains only: no social widgets, advertising CDNs or analytics.
const hosts = new Set([
  "www.runescape.com",
  "news.runescape.com",
  "secure.runescape.com",
  "services.runescape.com",
  "services.jagex.com",
  "www.jagex.com",
  "www.jagexstore.com",
  "www.runefest.com",
  "www.funorb.com",
]);
const extensions = new Set([
  ".html",
  ".htm",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);
const blocked =
  /(?:^|\/)(?:cookies?(?:[.\/]|$)|hts[-_]|logs?(?:[.\/]|$)|auth(?:[.\/]|$)|config(?:[.\/]|$)|login[^/]*|m=weblogin|m=create|account_management|email_registration|password[^/]*)(?:[^/]*)/i;
const latin1 = new TextDecoder("windows-1252");
const escaped = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const contained = (root: string, file: string) => {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
};

export class ArchiveSite {
  private constructor(
    readonly root: string,
    private readonly index: string,
  ) {}
  static async load(
    root = resolve(import.meta.dir, "../local/website-reference/2010-07-18"),
  ): Promise<ArchiveSite | undefined> {
    try {
      const canonical = await realpath(root);
      const indexPath = await realpath(
        resolve(canonical, "www.runescape.com/index.html"),
      );
      if (!contained(canonical, indexPath)) return undefined;
      return new ArchiveSite(
        canonical,
        latin1.decode(await readFile(indexPath)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  /** Resolve the mirror's relative cross-host links without ever producing a remote URL. */
  private url(value: string, host: string, path: string): string | undefined {
    const input = value.trim();
    if (!input || input.startsWith("#")) return input;
    if (
      /[\u0000-\u0020\u007f]/.test(input.replace(/ /g, "")) ||
      input.includes("\\")
    )
      return undefined;
    let targetHost = host,
      targetPath: string,
      hash = "";
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith("//")) {
        const target = new URL(input, "https://" + host + "/");
        if (
          !["http:", "https:"].includes(target.protocol) ||
          target.username ||
          target.password ||
          target.port
        )
          return undefined;
        targetHost = target.hostname.toLowerCase();
        targetPath = target.pathname;
        hash = target.hash;
      } else if (input.startsWith("/archive/")) {
        const target = new URL(input, "https://mirror.invalid");
        const parts = target.pathname.slice(9).split("/");
        targetHost = parts.shift()!;
        targetPath = "/" + parts.join("/");
        hash = target.hash;
      } else if (input.startsWith("/")) {
        const target = new URL(input, "https://" + host);
        targetPath = target.pathname;
        hash = target.hash;
      } else {
        const target = new URL(
          input,
          "https://mirror.invalid/" + host + "/" + path,
        );
        const parts = target.pathname.slice(1).split("/");
        targetHost = parts.shift()!;
        targetPath = "/" + parts.join("/");
        hash = target.hash;
      }
      if (!hosts.has(targetHost)) return undefined;
      const decoded = decodeURIComponent(targetPath);
      if (
        decoded.includes("\\") ||
        decoded.includes("\0") ||
        decoded.split("/").some((part) => part === ".." || part === ".")
      )
        return undefined;
      if (blocked.test(decoded)) return undefined;
      return "/archive/" + targetHost + targetPath + hash;
    } catch {
      return undefined;
    }
  }
  private css(source: string, host: string, path: string): string {
    return source
      .replace(
        /url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\)\s]*))\s*\)/gi,
        (_all, a, b, c) => {
          const url = this.url(a ?? b ?? c ?? "", host, path);
          return `url("${url?.replace(/"/g, "%22") ?? ""}")`;
        },
      )
      .replace(/@import\s+(["'])([^"']+)\1/gi, (_all, _quote, value) => {
        const url = this.url(value, host, path);
        return url
          ? `@import "${url.replace(/"/g, "%22")}"`
          : '@import url("")';
      })
      .replace(/(?:behavior|-moz-binding)\s*:[^;}]+[;}]?/gi, "");
  }
  private async sanitize(
    source: string,
    host: string,
    path: string,
    historical = false,
  ): Promise<string> {
    const site = this;
    // Inline CSS imports are relative to the source document, not to the app route.
    source = source.replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      (_all, open, css, close) => open + this.css(css, host, path) + close,
    );
    const rewriter = new HTMLRewriter()
      .on("script,iframe,object,embed,applet,base,frame,frameset,#advert", {
        element(element) {
          element.remove();
        },
      })
      .on('link[rel="alternate"]', {
        element(element) {
          if ((element.getAttribute("type") ?? "").includes("rss")) element.remove();
        },
      })
      .on("meta", {
        element(element) {
          if (element.getAttribute("http-equiv")) element.remove();
          if (element.getAttribute("charset"))
            element.setAttribute("charset", "utf-8");
        },
      })
      .on("*", {
        element(element) {
          for (const [attribute, value] of [...element.attributes]) {
            const name = attribute.toLowerCase();
            if (
              name.startsWith("on") ||
              [
                "srcdoc",
                "srcset",
                "ping",
                "formaction",
                "action",
                "target",
                "manifest",
              ].includes(name)
            ) {
              element.removeAttribute(attribute);
              continue;
            }
            if (
              ["href", "src", "background", "poster", "xlink:href"].includes(
                name,
              )
            ) {
              const mapped = site.url(value, host, path);
              if (mapped === undefined) element.removeAttribute(attribute);
              else element.setAttribute(attribute, mapped);
            }
            if (name === "style")
              element.setAttribute(attribute, site.css(value, host, path));
          }
        },
      })
      .on("form", {
        element(element) {
          element.setAttribute("data-archive-disabled", "true");
          element.setAttribute("inert", "");
          element.setAttribute("aria-disabled", "true");
          element.setAttribute("action", "#");
        },
      })
      .on("input,button,select,textarea", {
        element(element) {
          element.setAttribute("disabled", "");
        },
      })
      .on("head", {
        element(element) {
          element.prepend(
            '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
            { html: true },
          );
          element.append('<link rel="stylesheet" href="/site-overrides.css">', {
            html: true,
          });
        },
      })
      .on("#home", {
        element(element) {
          element.setAttribute("href", "/");
        },
      })
      .on("#play,#playExisting,#bannerPlay,#banner .bannerLink", {
        element(element) {
          element.setAttribute("href", "/play");
        },
      })
      .on("#login", {
        element(element) {
          element.setAttribute("href", "/admin");
        },
      })
      .on("#community", {
        element(element) {
          element.setAttribute("href", "/news");
        },
      })
      .on("#community > .ts", {
        element(element) {
          element.setInnerContent("News");
        },
      })
      .on("#players", {
        element(element) {
          element.setInnerContent(
            'Game world status is not configured. <a href="/status">Server status</a>',
            { html: true },
          );
        },
      })
      .onDocument({
        comments(comment) {
          comment.remove();
        },
      });
    if (historical)
      rewriter.on("body", {
        element(element) {
          element.prepend(
            '<aside class="site-archive-notice" role="note">Historical website reference from July 2010. Old announcements, account services and forms are not live. <a href="/">Return to 2010scape</a></aside>',
            { html: true },
          );
        },
      });
    return rewriter.transform(new Response(source)).text();
  }
  async renderHome(
    announcementsMarkup: string,
    statusMarkup?: string,
  ): Promise<string> {
    const clean = await this.sanitize(
      this.index,
      "www.runescape.com",
      "index.html",
    );
    const rewriter = new HTMLRewriter().on("#recentnews > .section", {
      element(element) {
        element.setInnerContent(announcementsMarkup, { html: true });
      },
    });
    if (statusMarkup !== undefined)
      rewriter.on("#players", {
        element(element) {
          element.setInnerContent(statusMarkup, { html: true });
        },
      });
    return rewriter.transform(new Response(clean)).text();
  }
  async renderPage(title: string, appBody: string): Promise<string> {
    const clean = await this.sanitize(
      this.index,
      "www.runescape.com",
      "index.html",
    );
    return new HTMLRewriter()
      .on("title", {
        element(element) {
          element.setInnerContent(escaped(title) + " - 2010scape", {
            html: true,
          });
        },
      })
      .on("body", {
        element(element) {
          element.setAttribute(
            "class",
            (element.getAttribute("class") ?? "") + " site-app-page",
          );
        },
      })
      .on("#content", {
        element(element) {
          element.setInnerContent(
            '<main class="site-app-content">' + appBody + "</main>",
            { html: true },
          );
        },
      })
      .transform(new Response(clean))
      .text();
  }
  async serve(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/archive/")) return undefined;
    const missing = () =>
      new Response("Archived file not available", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname.slice(9));
    } catch {
      return missing();
    }
    const parts = decoded.split("/"),
      host = parts.shift()!;
    if (
      !hosts.has(host) ||
      parts.some((part) => part === ".." || part === ".") ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      blocked.test(parts.join("/"))
    )
      return missing();
    try {
      const hostRoot = await realpath(resolve(this.root, host));
      if (!contained(this.root, hostRoot)) return missing();
      let candidate = resolve(hostRoot, ...parts);
      if (!contained(hostRoot, candidate)) return missing();
      if ((await stat(candidate)).isDirectory())
        candidate = resolve(candidate, "index.html");
      const file = await realpath(candidate);
      if (
        !contained(hostRoot, file) ||
        !extensions.has(extname(file).toLowerCase()) ||
        !(await stat(file)).isFile()
      )
        return missing();
      const extension = extname(file).toLowerCase();
      const relativePath = relative(hostRoot, file).split(sep).join("/");
      const headers: Record<string, string> = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      };
      if (extension === ".html" || extension === ".htm") {
        headers["Content-Type"] = "text/html; charset=utf-8";
        headers["Cache-Control"] = "no-store";
        const html = await this.sanitize(
          latin1.decode(await readFile(file)),
          host,
          relativePath,
          true,
        );
        return new Response(request.method === "HEAD" ? null : html, {
          headers,
        });
      }
      if (extension === ".css") {
        headers["Content-Type"] = "text/css; charset=utf-8";
        return new Response(
          request.method === "HEAD"
            ? null
            : this.css(latin1.decode(await readFile(file)), host, relativePath),
          { headers },
        );
      }
      return new Response(request.method === "HEAD" ? null : Bun.file(file), {
        headers,
      });
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR", "ELOOP", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return missing();
      throw error;
    }
  }
}
