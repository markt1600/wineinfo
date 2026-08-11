import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wine (a)ID",
    short_name: "Wine (a)ID",
    description:
      "Snap a photo of wine bottles, a store shelf, or a wine menu — identify the wines, get prices and ratings, and find the best value.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
