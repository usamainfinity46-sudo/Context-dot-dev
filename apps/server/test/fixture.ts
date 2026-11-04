import http from "node:http";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
export async function fixture() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://fixture").pathname;
    if (pathname === "/redirect-private") {
      res.writeHead(302, {
        location: "http://169.254.169.254/latest/meta-data",
      });
      res.end();
      return;
    }
    if (pathname === "/blocked") {
      res.writeHead(403, { "content-type": "text/html" });
      res.end("Access denied");
      return;
    }
    if (pathname === "/robots.txt") {
      res.setHeader("content-type", "text/plain");
      res.end("User-agent: *\nDisallow: /private\n");
      return;
    }
    if (pathname === "/sitemap.xml") {
      res.setHeader("content-type", "application/xml");
      res.end(
        '<?xml version="1.0"?><urlset><url><loc>/child</loc></url><url><loc>/private</loc></url></urlset>',
      );
      return;
    }
    if (pathname.endsWith(".png")) {
      res.setHeader("content-type", "image/png");
      res.end(png);
      return;
    }
    if (pathname === "/broken.jpg") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (pathname === "/shell") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<div id="root"></div><script>document.getElementById("root").innerHTML="<h1>Rendered application</h1><p>Loaded app content</p>"</script>',
      );
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html lang="en"><head><title>Extraction fixture</title><base href="/assets/"><meta name="description" content="A local integration test"><meta property="og:image" content="social.png"></head><body><main><h1>Fixture article</h1><p>${"Useful article content with factual detail. ".repeat(20)}</p><img src="first.png" alt="First image" width="320" height="200" srcset="first.png 1x, first.png?w=2 2x"><picture><source srcset="responsive.png 640w"></picture><div style="background-image:url(background.png);height:80px">Background</div><img src="/broken.jpg" alt="Broken"><form action="/submit"><label for="name">Full name</label><input id="name" name="name" required placeholder="Your name" value="DO_NOT_COLLECT"><select name="plan"><option value="personal">Personal</option></select></form><a href="/child">Child page</a><a href="/private">Private</a><div style="height:1100px">Scroll below</div><img id="lazy" data-src="lazy.png" alt="Lazy image"><script>new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.src=entry.target.dataset.src;entry.target.dataset.loaded='true'}}).observe(document.getElementById('lazy'))</script></main></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}` };
}
