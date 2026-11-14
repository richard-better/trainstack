import type { StyleSpecification } from "maplibre-gl";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export function routeMapStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (layer.type !== "fill" || layer.paint?.["fill-pattern"] !== "wood-pattern") return layer;
      const paint = { ...layer.paint };
      delete paint["fill-pattern"];
      return { ...layer, paint };
    }),
  };
}
