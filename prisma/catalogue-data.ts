/**
 * The ASTU category catalogue — the kinds of equipment ASTU's colleges keep, university-
 * wide (looked after by Property Administration), for departments to use as they are or
 * copy and refine (docs/decisions/2026-10-01-ux-flow-plan.md, Appendix A).
 *
 * Sources: astu.edu.et (colleges, schools and departments); the Chemical Engineering
 * department's own equipment list (prisma/chem-lab-data.ts) and the CSE lab list
 * (docs/cse_labs.md); the rest is standard equipment for those programmes.
 *
 * Every instrument records the same core details (Manufacturer, Model, Serial no., Asset
 * tag, Year acquired, Calibration due, Notes) plus its own. `bookable` makes it bookable
 * equipment; `portal` lists its count on the public portal (instruments outsiders send
 * samples to).
 */
import type { CategorySpec, FieldSpec } from "./resource-seed";

export const CATALOGUE_GROUPS = [
  "Electrical & electronics",
  "Mechanical & manufacturing",
  "Materials testing",
  "Civil, water & surveying",
  "Architecture & design",
  "Analytical & life sciences",
  "Geology & physics",
] as const;

/** The details every instrument records. */
export const INSTRUMENT_FIELDS: FieldSpec[] = [
  { key: "manufacturer", label: "Manufacturer", type: "TEXT" },
  { key: "model", label: "Model", type: "TEXT", summary: true },
  { key: "serial", label: "Serial no.", type: "TEXT" },
  { key: "assetTag", label: "Asset tag", type: "TEXT", hint: "e.g. ASTU-00123" },
  { key: "yearAcquired", label: "Year acquired", type: "NUMBER" },
  { key: "calibrationDue", label: "Calibration due", type: "DATE" },
  { key: "notes", label: "Notes", type: "TEXT", longText: true },
];

const num = (key: string, label: string, unit: string, summary = true): FieldSpec => ({ key, label, type: "NUMBER", unit, summary });
const choice = (key: string, label: string, options: string[], summary = true): FieldSpec => ({ key, label, type: "ENUM", options, summary });

interface Opts {
  extra?: FieldSpec[];
  bookable?: boolean;
  portal?: boolean;
  description?: string;
}

/** One instrument category: the shared details, then its own. */
function inst(key: string, name: string, iconKey: string, group: string, o: Opts = {}): CategorySpec {
  return {
    key,
    name,
    iconKey,
    group,
    countingMode: "SERIALIZED",
    impairRule: "ANY_CRITICAL",
    description: o.description,
    bookingMode: o.bookable || o.portal ? "EQUIPMENT" : "NOT_BOOKABLE",
    publicListed: o.portal ?? false,
    // Manufacturer and Model first, then its own details, then the record-keeping ones.
    fields: [...INSTRUMENT_FIELDS.slice(0, 2), ...(o.extra ?? []), ...INSTRUMENT_FIELDS.slice(2)],
  };
}

/** Something counted, not tracked one by one. */
function bulk(key: string, name: string, iconKey: string, group: string, unit: string, extra: FieldSpec[] = [], description?: string): CategorySpec {
  return { key, name, iconKey, group, countingMode: "BULK", unit, impairRule: "NEVER", description, fields: extra };
}

/** A plain thing with a few details of its own and no instrument record. */
function thing(key: string, name: string, iconKey: string, group: string, fields: FieldSpec[] = [], description?: string): CategorySpec {
  return { key, name, iconKey, group, countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", description, fields };
}

const EE = "Electrical & electronics";
const ME = "Mechanical & manufacturing";
const MT = "Materials testing";
const CV = "Civil, water & surveying";
const AR = "Architecture & design";
const AN = "Analytical & life sciences";
const GP = "Geology & physics";
const IT = "Computing & AV";
const FS = "Furniture & safety";
const CH = "Chemicals & consumables";

const maxTemp = num("maxTempC", "Max temperature", "°C");

export const CATALOGUE_SPECS: CategorySpec[] = [
  // ── Computing & AV (shared; Computer, Monitor, Keyboard… are in resource-seed.ts) ──
  thing("laptop", "Laptop", "Laptop", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, { key: "serial", label: "Serial no.", type: "TEXT" }, num("ramGB", "RAM", "GB"), num("storageGB", "Storage", "GB", false)]),
  thing("server", "Server", "Server", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, { key: "serial", label: "Serial no.", type: "TEXT" }, num("ramGB", "RAM", "GB"), { key: "role", label: "Used for", type: "TEXT" }]),
  thing("router", "Router / Wi-Fi access point", "Router", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, { key: "ip", label: "Address", type: "TEXT", hint: "e.g. 10.10.4.1" }]),
  thing("ups", "UPS", "BatteryCharging", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, num("capacityVA", "Capacity", "VA"), { key: "batteryReplaced", label: "Battery replaced", type: "DATE" }]),
  { ...thing("projector", "Projector", "Projector", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, num("lumens", "Brightness", "lm"), { key: "lampHours", label: "Lamp hours", type: "NUMBER" }]), bookingMode: "EQUIPMENT" },
  thing("interactive-board", "Interactive board", "Presentation", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, num("sizeIn", "Size", '"')]),
  thing("printer", "Printer / plotter", "Printer", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }, choice("kind", "Kind", ["Laser", "Inkjet", "Plotter", "Multifunction"])]),
  inst("printer-3d", "3D printer", "Box", IT, { bookable: true, extra: [choice("technology", "Technology", ["FDM", "SLA", "SLS"]), { key: "buildVolume", label: "Build volume", type: "TEXT", hint: "e.g. 220 × 220 × 250 mm" }] }),
  thing("document-camera", "Document camera", "Camera", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }]),
  thing("headset", "Headset (language lab)", "Headphones", IT, [{ key: "model", label: "Model", type: "TEXT", summary: true }]),

  // ── Furniture & safety (Table, Chair, Whiteboard are in resource-seed.ts) ──────
  thing("lab-bench", "Lab bench", "Table2", FS, [num("lengthCm", "Length", "cm"), choice("top", "Top", ["Epoxy", "Laminate", "Stainless steel", "Wood"])]),
  thing("stool", "Stool", "Armchair", FS),
  thing("fume-hood", "Fume hood", "Wind", FS, [{ key: "model", label: "Model", type: "TEXT", summary: true }, { key: "lastTested", label: "Airflow last tested", type: "DATE" }], "Ducted or ductless; airflow tested yearly."),
  thing("fire-extinguisher", "Fire extinguisher", "FireExtinguisher", FS, [choice("kind", "Kind", ["CO₂", "Dry powder", "Foam", "Water"]), num("sizeKg", "Size", "kg"), { key: "expiry", label: "Expiry", type: "DATE", summary: true }, { key: "lastInspected", label: "Last inspected", type: "DATE" }]),
  thing("eye-wash", "Eye-wash station", "Droplets", FS, [{ key: "lastChecked", label: "Last checked", type: "DATE" }]),
  thing("first-aid-kit", "First-aid kit", "BriefcaseMedical", FS, [{ key: "lastChecked", label: "Last checked", type: "DATE", summary: true }]),
  thing("safety-cabinet", "Safety cabinet", "Archive", FS, [choice("kind", "For", ["Flammables", "Acids", "Bases", "Toxics", "Gas cylinders"])]),
  bulk("ppe", "Personal protective equipment", "HardHat", FS, "pcs", [choice("kind", "Kind", ["Lab coat", "Gloves", "Goggles", "Face shield", "Respirator", "Helmet", "Safety boots"]), { key: "size", label: "Size", type: "TEXT" }]),

  // ── Chemicals & consumables (Chemical or reagent, Glassware are in resource-seed.ts) ──
  bulk("lab-consumables", "Lab consumables", "TestTube", CH, "pcs", [{ key: "kind", label: "Kind", type: "TEXT", summary: true, hint: "e.g. Filter paper Ø110 mm" }], "Filter paper, pipette tips, gloves — used up, counted by quantity."),

  // ── Electrical & electronics (CoEEC: CSE, ECE, EPCE, SE) ─────────────────────
  inst("oscilloscope", "Oscilloscope", "Activity", EE, { bookable: true, extra: [num("bandwidthMHz", "Bandwidth", "MHz"), num("channels", "Channels", "")] }),
  inst("function-generator", "Function generator", "AudioWaveform", EE, { extra: [num("maxFreqMHz", "Max frequency", "MHz")] }),
  inst("dc-power-supply", "DC power supply", "BatteryCharging", EE, { extra: [num("maxVoltage", "Max voltage", "V"), num("maxCurrent", "Max current", "A")] }),
  inst("multimeter", "Digital multimeter", "Gauge", EE),
  inst("spectrum-analyser", "Spectrum analyser", "Activity", EE, { portal: true, extra: [num("rangeGHz", "Range up to", "GHz")] }),
  inst("logic-analyser", "Logic analyser", "Binary", EE, { extra: [num("channels", "Channels", "")] }),
  inst("mcu-kit", "Microcontroller / FPGA kit", "Cpu", EE, { extra: [{ key: "board", label: "Board", type: "TEXT", summary: true, hint: "e.g. Arduino Mega, Basys 3" }] }),
  inst("embedded-trainer", "Embedded systems trainer", "CircuitBoard", EE),
  inst("comms-trainer", "Communication trainer", "Radio", EE, { extra: [choice("kind", "Kind", ["Analogue", "Digital", "Analogue & digital"])] }),
  inst("microwave-trainer", "Microwave / antenna trainer", "RadioTower", EE),
  inst("fibre-trainer", "Fibre-optic trainer", "Cable", EE),
  inst("plc-trainer", "PLC trainer", "ToggleRight", EE, { extra: [{ key: "plc", label: "PLC", type: "TEXT", hint: "e.g. Siemens S7-1200" }] }),
  inst("control-trainer", "Control systems trainer", "SlidersHorizontal", EE),
  inst("machines-trainer", "Electrical machines trainer", "Cog", EE, { extra: [choice("kind", "Machine", ["DC motor", "Induction motor", "Synchronous machine", "Generator set"])] }),
  inst("transformer-trainer", "Transformer trainer", "Zap", EE, { extra: [num("ratingKVA", "Rating", "kVA")] }),
  inst("power-system-sim", "Power-system simulator", "Network", EE),
  inst("hv-test-set", "High-voltage test set", "Zap", EE, { portal: true, extra: [num("maxKV", "Max voltage", "kV")] }),
  inst("power-analyser", "Power analyser", "Gauge", EE),
  inst("solar-trainer", "Solar PV trainer", "Sun", EE, { extra: [num("panelW", "Panel", "W")] }),
  thing("soldering-station", "Soldering station", "Flame", EE, [{ key: "model", label: "Model", type: "TEXT", summary: true }]),
  bulk("components", "Electronic components", "CircuitBoard", EE, "pcs", [{ key: "kind", label: "Kind", type: "TEXT", summary: true, hint: "e.g. 10 kΩ resistor" }]),

  // ── Mechanical & manufacturing (CoMCME: Mechanical) ──────────────────────────
  inst("lathe", "Lathe", "Cog", ME, { bookable: true, extra: [num("swingMm", "Swing", "mm"), num("betweenCentresMm", "Between centres", "mm", false)] }),
  inst("milling-machine", "Milling machine", "Cog", ME, { bookable: true, extra: [choice("kind", "Kind", ["Vertical", "Horizontal", "Universal"])] }),
  inst("cnc-machine", "CNC machine", "Cpu", ME, { bookable: true, extra: [choice("kind", "Kind", ["Mill", "Lathe", "Router", "Plasma"]), num("axes", "Axes", "")] }),
  inst("drilling-machine", "Drilling machine", "Drill", ME),
  inst("grinding-machine", "Grinding machine", "Disc", ME, { extra: [choice("kind", "Kind", ["Surface", "Cylindrical", "Bench"])] }),
  inst("welding-machine", "Welding machine", "Flame", ME, { extra: [choice("process", "Process", ["Arc (SMAW)", "MIG", "TIG", "Spot", "Gas"])] }),
  thing("sheet-metal-tools", "Sheet-metal tools", "Scissors", ME, [{ key: "set", label: "Set", type: "TEXT", summary: true }]),
  inst("engine-test-bed", "Engine test bed", "Gauge", ME, { portal: true, extra: [choice("fuel", "Fuel", ["Petrol", "Diesel", "Dual"])] }),
  inst("engine-cutaway", "IC engine cut-section", "Cog", ME),
  inst("automotive-trainer", "Automotive trainer", "Car", ME, { extra: [choice("system", "System", ["Brakes", "Transmission", "Electrical", "Fuel injection", "Steering & suspension"])] }),
  inst("refrigeration-trainer", "Refrigeration & air-conditioning trainer", "Snowflake", ME),
  inst("boiler-trainer", "Steam / boiler trainer", "Flame", ME),
  inst("heat-engine-trainer", "Heat-engine trainer", "Thermometer", ME),
  inst("fluid-bench", "Fluid mechanics bench", "WavesHorizontal", ME),
  inst("pump-test-rig", "Pump test rig", "Droplets", ME),
  inst("wind-tunnel", "Wind tunnel", "Wind", ME, { bookable: true, extra: [num("maxSpeed", "Max air speed", "m/s")] }),
  inst("vibration-trainer", "Vibration trainer", "Activity", ME),
  thing("hand-tool-kit", "Hand tool kit", "Wrench", ME, [{ key: "contents", label: "Contents", type: "TEXT", longText: true }]),

  // ── Materials testing (CoMCME: Materials; CoCEA) ─────────────────────────────
  inst("utm", "Universal testing machine", "Gauge", MT, { portal: true, extra: [num("capacityKN", "Capacity", "kN")] }),
  inst("hardness-tester", "Hardness tester", "Gauge", MT, { extra: [choice("scale", "Scale", ["Rockwell", "Brinell", "Vickers", "Shore"])] }),
  inst("impact-tester", "Impact tester", "Hammer", MT, { extra: [choice("kind", "Kind", ["Charpy", "Izod", "Charpy & Izod"])] }),
  inst("fatigue-tester", "Fatigue tester", "Activity", MT),
  inst("metallurgical-microscope", "Metallurgical microscope", "Microscope", MT, { extra: [num("maxMag", "Max magnification", "×")] }),
  inst("polisher", "Polishing / grinding machine", "Disc", MT),
  inst("muffle-furnace", "Muffle furnace", "Flame", MT, { extra: [maxTemp] }),
  inst("xrd", "X-ray diffractometer (XRD)", "Atom", MT, { portal: true }),
  inst("sem", "Scanning electron microscope (SEM)", "Microscope", MT, { portal: true }),
  inst("thermal-analyser", "Thermal analyser (TGA / DSC)", "Thermometer", MT, { portal: true, extra: [maxTemp] }),
  inst("ftir", "FTIR spectrometer", "Activity", MT, { portal: true }),

  // ── Civil, water & surveying (CoCEA) ─────────────────────────────────────────
  inst("compression-machine", "Concrete compression machine", "Gauge", CV, { portal: true, extra: [num("capacityKN", "Capacity", "kN")] }),
  thing("concrete-mixer", "Concrete mixer", "RefreshCw", CV, [num("capacityL", "Capacity", "L")]),
  bulk("slump-cone", "Slump cone set", "Triangle", CV, "sets"),
  inst("sieve-shaker", "Sieve shaker", "Vibrate", CV),
  inst("la-abrasion", "Los Angeles abrasion machine", "RefreshCw", CV),
  inst("marshall-tester", "Marshall stability tester", "Gauge", CV, { portal: true }),
  thing("casagrande", "Casagrande (liquid limit) apparatus", "Beaker", CV),
  inst("direct-shear", "Direct shear apparatus", "SlidersHorizontal", CV),
  inst("triaxial", "Triaxial apparatus", "Gauge", CV, { portal: true }),
  inst("consolidometer", "Consolidometer (oedometer)", "Gauge", CV),
  thing("proctor-set", "Proctor compaction set", "Hammer", CV, [choice("kind", "Kind", ["Standard", "Modified"])]),
  inst("hydraulics-flume", "Hydraulics flume", "WavesHorizontal", CV, { extra: [num("lengthM", "Length", "m")] }),
  inst("hydraulics-bench", "Hydraulics bench", "Droplets", CV),
  inst("total-station", "Total station", "Crosshair", CV, { bookable: true, extra: [num("accuracySec", "Angular accuracy", "″")] }),
  inst("gnss-receiver", "GNSS receiver", "Satellite", CV, { bookable: true }),
  inst("auto-level", "Automatic level", "Ruler", CV, { bookable: true }),
  inst("theodolite", "Theodolite", "Compass", CV, { bookable: true }),
  inst("drone", "Drone (UAV)", "Drone", CV, { bookable: true, extra: [{ key: "registration", label: "Registration", type: "TEXT" }] }),
  inst("water-quality-meter", "Water-quality meter", "Droplet", CV, { extra: [{ key: "parameters", label: "Measures", type: "TEXT", hint: "e.g. pH, DO, turbidity" }] }),
  thing("rain-gauge", "Rain gauge", "CloudRain", CV, [{ key: "site", label: "Site", type: "TEXT" }]),

  // ── Architecture & design (CoCEA: Architecture, Urban Planning) ──────────────
  thing("drafting-table", "Drafting table", "PencilRuler", AR, [{ key: "size", label: "Size", type: "TEXT", hint: "e.g. A0" }]),
  inst("laser-cutter", "Laser cutter", "Scissors", AR, { bookable: true, extra: [num("powerW", "Power", "W"), { key: "bed", label: "Bed size", type: "TEXT", hint: "e.g. 600 × 400 mm" }] }),
  thing("model-tools", "Model-making tool set", "Scissors", AR, [{ key: "contents", label: "Contents", type: "TEXT", longText: true }]),
  thing("large-plotter", "Large-format plotter", "Printer", AR, [{ key: "model", label: "Model", type: "TEXT", summary: true }, { key: "width", label: "Paper width", type: "TEXT", hint: "e.g. 36 in" }]),

  // ── Analytical & life sciences (CoANS: Applied Chemistry, Biology; Pharmacy) ─
  inst("uv-vis", "UV-Vis spectrophotometer", "Activity", AN, { portal: true, extra: [{ key: "range", label: "Range", type: "TEXT", hint: "e.g. 190–1100 nm" }] }),
  inst("aas", "Atomic absorption spectrometer (AAS)", "Flame", AN, { portal: true }),
  inst("hplc", "HPLC", "SlidersHorizontal", AN, { portal: true, extra: [{ key: "detector", label: "Detector", type: "TEXT" }] }),
  inst("gc", "Gas chromatograph (GC)", "SlidersHorizontal", AN, { portal: true, extra: [{ key: "detector", label: "Detector", type: "TEXT", hint: "e.g. FID, MS" }] }),
  inst("analytical-balance", "Analytical balance", "Scale", AN, { extra: [num("capacityG", "Capacity", "g"), num("readabilityMg", "Readability", "mg")] }),
  inst("ph-meter", "pH / conductivity meter", "Gauge", AN),
  inst("centrifuge", "Centrifuge", "RefreshCw", AN, { extra: [num("maxRpm", "Max speed", "rpm")] }),
  inst("rotary-evaporator", "Rotary evaporator", "RefreshCw", AN),
  inst("hot-plate", "Hot plate / stirrer", "Flame", AN, { extra: [maxTemp] }),
  inst("drying-oven", "Drying oven", "Thermometer", AN, { extra: [maxTemp, num("volumeL", "Volume", "L", false)] }),
  inst("incubator", "Incubator", "Thermometer", AN, { extra: [maxTemp, choice("kind", "Kind", ["General", "CO₂", "Shaking", "BOD"])] }),
  inst("autoclave", "Autoclave", "Flame", AN, { extra: [num("volumeL", "Volume", "L")] }),
  inst("laminar-flow", "Laminar-flow cabinet", "Wind", AN),
  inst("biosafety-cabinet", "Biosafety cabinet", "ShieldAlert", AN, { extra: [choice("class", "Class", ["I", "II", "III"])] }),
  inst("compound-microscope", "Compound microscope", "Microscope", AN, { extra: [num("maxMag", "Max magnification", "×")] }),
  inst("stereo-microscope", "Stereo microscope", "Microscope", AN),
  inst("pcr", "PCR thermocycler", "Dna", AN, { portal: true }),
  inst("gel-electrophoresis", "Gel electrophoresis unit", "Rows3", AN),
  inst("lab-freezer", "Lab refrigerator / freezer", "Snowflake", AN, { extra: [num("minTempC", "Lowest temperature", "°C")] }),
  inst("water-still", "Water distiller / deioniser", "Droplet", AN, { extra: [num("outputLh", "Output", "L/h")] }),
  inst("dissolution-tester", "Dissolution tester", "TestTubes", AN),
  inst("tablet-press", "Tablet press", "Pill", AN),

  // ── Geology & physics (CoANS: Applied Geology, Applied Physics) ─────────────
  inst("petrographic-microscope", "Petrographic microscope", "Microscope", GP),
  inst("rock-saw", "Rock saw", "Disc", GP),
  thing("thin-section-kit", "Thin-section kit", "Layers", GP),
  bulk("specimen-set", "Rock & mineral specimen set", "Gem", GP, "sets"),
  thing("field-kit", "Geology field kit", "Compass", GP, [{ key: "contents", label: "Contents", type: "TEXT", longText: true, hint: "e.g. GPS, compass-clinometer, hammer, hand lens" }]),
  inst("optics-bench", "Optics bench", "Ruler", GP),
  inst("laser", "Laser", "Zap", GP, { extra: [num("wavelengthNm", "Wavelength", "nm"), num("powerMw", "Power", "mW")] }),
  inst("spectrometer", "Spectrometer", "Rainbow", GP),
  inst("radiation-counter", "Radiation counter", "Radiation", GP),
  thing("physics-kit", "Physics experiment kit", "Magnet", GP, [choice("topic", "Topic", ["Mechanics", "Electricity & magnetism", "Optics", "Heat", "Modern physics"])]),
];

/** The chemicals category, richer than the fixture's: GHS hazard, grade, storage, expiry. */
export const CHEMICAL_FIELDS: FieldSpec[] = [
  { key: "casNumber", label: "CAS no.", type: "TEXT", summary: true, hint: "e.g. 64-17-5" },
  { key: "formula", label: "Formula", type: "TEXT", hint: "e.g. C2H5OH" },
  choice("hazard", "Hazard", ["Flammable", "Corrosive", "Toxic", "Oxidiser", "Irritant", "Health hazard", "Environmental hazard", "Explosive", "Compressed gas", "None"]),
  choice("grade", "Grade", ["Analytical (AR)", "Laboratory (LR)", "Technical"], false),
  { key: "purity", label: "Purity", type: "NUMBER", unit: "%" },
  choice("storage", "Store in", ["Flammables cabinet", "Acid cabinet", "Base cabinet", "Cold (2–8 °C)", "General shelf"], false),
  { key: "expiry", label: "Expiry", type: "DATE", summary: true },
];
