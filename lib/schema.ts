// Shared result types + the JSON schema the model's final answer must match.

export type SceneType =
  | "single_bottle"
  | "bottle_group"
  | "shelf_with_prices"
  | "wine_menu"
  | "other";

export interface BoundingBox {
  // Pixel coordinates in the submitted image (top-left origin).
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Money {
  amount: number;
  currency: string; // ISO 4217, e.g. "USD"
}

export interface Rating {
  source: string; // e.g. "CellarTracker", "Vivino", "Wine Spectator"
  score: string; // e.g. "91", "4.2/5"
  vintageMatch: boolean; // true if the rating is for the exact vintage in the photo
  url: string | null;
}

export interface BottleResult {
  id: string;
  identified: boolean;
  boundingBox: BoundingBox | null;
  labelText: string; // what is visible on the label / menu line
  producer: string | null;
  wineName: string | null;
  vintage: string | null;
  region: string | null;
  grapeVariety: string | null;
  wineType: string | null; // red / white / rosé / sparkling / dessert / fortified
  listedPrice: Money | null; // price shown in the photo (shelf tag or menu)
  marketPrice: Money | null; // typical retail price found online
  marketPriceSource: string | null;
  ratings: Rating[];
  valueAssessment: string | null; // short judgement of listed vs market price
  notes: string;
}

export interface AnalysisResult {
  sceneType: SceneType;
  imageDescription: string;
  currency: {
    code: string | null; // ISO 4217 of the listed prices, if any
    detected: boolean;
    needsUserInput: boolean; // true => UI should ask the user for the currency
    reasoning: string;
  };
  bottles: BottleResult[];
  bestValue: {
    bottleId: string | null;
    reasoning: string;
  };
  summary: string;
}

// JSON schema for structured outputs (output_config.format).
// Structured-outputs rules: every object needs additionalProperties:false and
// a required list; no numeric/string constraints.
const moneySchema = {
  type: ["object", "null"],
  properties: {
    amount: { type: "number" },
    currency: { type: "string", description: "ISO 4217 code, e.g. USD" },
  },
  required: ["amount", "currency"],
  additionalProperties: false,
} as const;

export const analysisJsonSchema = {
  type: "object",
  properties: {
    sceneType: {
      type: "string",
      enum: [
        "single_bottle",
        "bottle_group",
        "shelf_with_prices",
        "wine_menu",
        "other",
      ],
    },
    imageDescription: { type: "string" },
    currency: {
      type: "object",
      properties: {
        code: { type: ["string", "null"] },
        detected: { type: "boolean" },
        needsUserInput: { type: "boolean" },
        reasoning: { type: "string" },
      },
      required: ["code", "detected", "needsUserInput", "reasoning"],
      additionalProperties: false,
    },
    bottles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          identified: { type: "boolean" },
          boundingBox: {
            type: ["object", "null"],
            description:
              "Pixel coordinates in the submitted image, top-left origin",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
          labelText: { type: "string" },
          producer: { type: ["string", "null"] },
          wineName: { type: ["string", "null"] },
          vintage: { type: ["string", "null"] },
          region: { type: ["string", "null"] },
          grapeVariety: { type: ["string", "null"] },
          wineType: { type: ["string", "null"] },
          listedPrice: moneySchema,
          marketPrice: moneySchema,
          marketPriceSource: { type: ["string", "null"] },
          ratings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                score: { type: "string" },
                vintageMatch: {
                  type: "boolean",
                  description:
                    "true when the rating is for the exact vintage seen in the photo; false when it is for the wine in general or a different vintage",
                },
                url: { type: ["string", "null"] },
              },
              required: ["source", "score", "vintageMatch", "url"],
              additionalProperties: false,
            },
          },
          valueAssessment: { type: ["string", "null"] },
          notes: { type: "string" },
        },
        required: [
          "id",
          "identified",
          "boundingBox",
          "labelText",
          "producer",
          "wineName",
          "vintage",
          "region",
          "grapeVariety",
          "wineType",
          "listedPrice",
          "marketPrice",
          "marketPriceSource",
          "ratings",
          "valueAssessment",
          "notes",
        ],
        additionalProperties: false,
      },
    },
    bestValue: {
      type: "object",
      properties: {
        bottleId: { type: ["string", "null"] },
        reasoning: { type: "string" },
      },
      required: ["bottleId", "reasoning"],
      additionalProperties: false,
    },
    summary: { type: "string" },
  },
  required: [
    "sceneType",
    "imageDescription",
    "currency",
    "bottles",
    "bestValue",
    "summary",
  ],
  additionalProperties: false,
} as const;
