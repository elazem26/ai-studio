export interface BackgroundPreset {
  description: string;
  color: string;
}

export const BACKGROUND_PRESETS: Record<string, Record<string, BackgroundPreset>> = {
  "مناظر طبيعية": {
    "غابة":      { description: "Dense green forest with sunlight filtering through tall trees, moss-covered ground", color: "#2d5016" },
    "شاطئ":      { description: "Tropical beach with white sand, turquoise water, clear blue sky, gentle waves", color: "#87CEEB" },
    "جبال":      { description: "Snow-capped mountain peaks under a clear blue sky, alpine landscape", color: "#4a6fa5" },
    "غروب":      { description: "Golden sunset over a calm ocean, orange and purple sky, palm tree silhouettes", color: "#ff6b35" },
    "حديقة":     { description: "Lush flower garden with roses, tulips, lavender, soft bokeh, sunny day", color: "#5a9b5e" },
    "صحراء":     { description: "Vast desert with golden sand dunes, clear blue sky, heat haze", color: "#c2a878" },
  },
  "داخلي": {
    "استوديو":   { description: "Professional photography studio with white seamless backdrop, soft studio lighting", color: "#f0f0f0" },
    "غرفة معيشة": { description: "Modern living room with warm lighting, sofa, bookshelf, wooden floor", color: "#3a2a1a" },
    "مكتب":      { description: "Clean modern office with glass walls, desk, ergonomic chair, bright lighting", color: "#2a3a4a" },
    "غرفة نوم":  { description: "Cozy bedroom with warm lamp light, soft bed, curtains, intimate ambiance", color: "#2a1a2a" },
    "مطبخ":      { description: "Modern kitchen with marble countertops, stainless steel, warm lighting", color: "#3a3a3a" },
    "مكتبة":     { description: "Classic library with tall wooden bookshelves, warm reading lamp, leather chairs", color: "#3a2010" },
  },
  "حضري": {
    "مدينة ليلًا": { description: "City street at night with neon lights, reflections on wet pavement, bokeh", color: "#0a0a2a" },
    "أفق المدينة": { description: "Rooftop view of modern city skyline at golden hour, skyscrapers, clear sky", color: "#4a5a6a" },
    "مقهى":      { description: "Cozy Parisian cafe interior with warm lighting, wooden tables, plants", color: "#3a2a1a" },
    "شارع":      { description: "European cobblestone street with old buildings, warm afternoon light", color: "#5a4a3a" },
    "مترو":      { description: "Modern subway station with bright fluorescent lighting, clean tiles", color: "#2a2a3a" },
    "جسر":       { description: "Iconic bridge at sunset, cityscape in background, golden light on water", color: "#5a4a3a" },
  },
  "تجريدي": {
    "تدرج بنفسجي":  { description: "Smooth gradient background from deep purple to bright pink, soft blurred", color: "#2d1b4e" },
    "تدرج أزرق":   { description: "Soft blue to teal gradient, calm and professional, minimal", color: "#1a3a4a" },
    "تدرج برتقالي": { description: "Warm orange to yellow gradient, sunny and cheerful, soft bokeh", color: "#ff8c00" },
    "بوكيه":      { description: "Abstract bokeh with soft circular light spots in warm colors, dreamy", color: "#1a1a2a" },
    "هندسي":      { description: "Abstract geometric pattern with triangles in purple and blue, modern art", color: "#2a1a4a" },
    "بسيط":       { description: "Minimal solid dark gray background, professional, clean, studio quality", color: "#1a1a1a" },
  },
};

export const BACKGROUND_CATEGORIES = Object.keys(BACKGROUND_PRESETS);
