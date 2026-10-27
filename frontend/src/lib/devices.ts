// The devices a rider can pick in their profile. The make and model ids are
// stored on the account (user_metadata.device_make / device_model) and sent
// with an export, where the backend shapes the file for the make (see
// DEVICE_MAKES in backend/randoo/export.py). "other" is a make and a model of
// its own, labelled in the locale files; every make offers it as its model
// until real models are added.
export interface DeviceModel {
  id: string;
  name: string;
}

export interface DeviceMake {
  id: string;
  name: string | null; // null: label comes from the locale files ("device.other")
  models: DeviceModel[];
}

export const OTHER = "other";

export const DEVICE_MAKES: DeviceMake[] = [
  {
    id: "garmin",
    name: "Garmin",
    models: [
      { id: "edge_840", name: "Edge 840" },
      { id: "edge_850", name: "Edge 850" },
      { id: "edge_1040", name: "Edge 1040" },
      { id: "edge_1050", name: "Edge 1050" },
      { id: "explore_2", name: "Explore 2" },
    ],
  },
  { id: "wahoo", name: "Wahoo", models: [] },
  { id: "karoo", name: "Karoo", models: [] },
  { id: "sigma", name: "Sigma", models: [] },
  { id: OTHER, name: null, models: [] },
];

export function deviceFromUser(metadata: Record<string, unknown> | undefined): { make: string; model: string } {
  const make = typeof metadata?.device_make === "string" ? metadata.device_make : "";
  const model = typeof metadata?.device_model === "string" ? metadata.device_model : "";
  return { make: DEVICE_MAKES.some((m) => m.id === make) ? make : "", model };
}
