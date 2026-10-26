import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import katex from "katex";

export const config = { dir: { input: "src" } };

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    formats: ["avif", "webp", "png"],
    widths: [480, 960, 1440],
    htmlOptions: { imgAttributes: { loading: "lazy", decoding: "async" } },
  });

  // Render \( inline \) and \[ display \] LaTeX at build time
  eleventyConfig.addTransform("math", function (content) {
    if (!this.page.outputPath?.endsWith(".html")) return content;
    return content.replace(/\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g, (_, display, inline) =>
      katex.renderToString(display ?? inline, { displayMode: display !== undefined })
    );
  });

  eleventyConfig.addPassthroughCopy({
    "src/static": "static",
    "src/spell": "spell",
    "src/main.js": "main.js",
    "src/style.css": "style.css",
    "src/papers": "/",
    "node_modules/katex/dist/katex.min.css": "katex/katex.min.css",
    "node_modules/katex/dist/fonts": "katex/fonts",
  });
}
