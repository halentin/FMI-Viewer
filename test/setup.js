// Downloads Reference FMUs for testing (cached in test/fixtures/)
const https = require("https");
const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");

const URL =
  "https://github.com/modelica/Reference-FMUs/releases/download/v0.0.39/Reference-FMUs-0.0.39.zip";
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const ZIP_PATH = path.join(FIXTURES_DIR, "Reference-FMUs.zip");
const MARKER = path.join(FIXTURES_DIR, ".extracted");

async function main() {
  if (fs.existsSync(MARKER)) {
    console.log("Test fixtures already present, skipping download.");
    return;
  }

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  if (!fs.existsSync(ZIP_PATH)) {
    console.log("Downloading Reference FMUs...");
    await download(URL, ZIP_PATH);
    console.log("Download complete.");
  }

  console.log("Extracting .fmu files...");
  await extractFmus(ZIP_PATH, FIXTURES_DIR);
  fs.writeFileSync(MARKER, new Date().toISOString());
  console.log("Test fixtures ready.");
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (url) => {
      https
        .get(url, (res) => {
          // Follow redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
        })
        .on("error", (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
    };
    request(url);
  });
}

function extractFmus(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error("Failed to open ZIP"));

      let pending = 0;
      let ended = false;

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const name = entry.fileName;
        if (name.endsWith(".fmu") && !name.startsWith("__MACOSX")) {
          // Preserve version subdirectory: "Reference-FMUs-0.0.39/3.0/Foo.fmu" -> "3.0/Foo.fmu"
          const parts = name.split("/");
          // Find the version part (e.g. "2.0" or "3.0")
          let relPath = path.basename(name);
          for (let i = 0; i < parts.length - 1; i++) {
            if (/^\d+\.\d+$/.test(parts[i])) {
              relPath = parts.slice(i).join("/");
              break;
            }
          }
          const dest = path.join(outDir, relPath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          pending++;
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2) return reject(err2);
            const out = fs.createWriteStream(dest);
            stream.pipe(out);
            out.on("finish", () => {
              pending--;
              if (ended && pending === 0) resolve();
            });
          });
        }
        zipfile.readEntry();
      });
      zipfile.on("end", () => {
        ended = true;
        if (pending === 0) resolve();
      });
      zipfile.on("error", reject);
    });
  });
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
