/**
 * Places the `map` element can pin, as [longitude, latitude]. The LLM names
 * places; positions come from here, never from the script.
 */
export const PLACES: Readonly<Record<string, readonly [number, number]>> = {
  // continents and regions
  africa: [20, 5], asia: [90, 45], europe: [15, 50], "north america": [-100, 45], "south america": [-60, -15],
  australia: [134, -25], oceania: [140, -25], antarctica: [0, -78], "middle east": [45, 28], arctic: [0, 82],
  // countries
  india: [79, 22], china: [104, 35], japan: [138, 37], "united states": [-98, 39], usa: [-98, 39], us: [-98, 39], america: [-98, 39],
  canada: [-106, 56], mexico: [-102, 23], brazil: [-52, -10], argentina: [-64, -34], "united kingdom": [-2, 54], uk: [-2, 54],
  britain: [-2, 54], england: [-1, 52], ireland: [-8, 53], france: [2, 47], germany: [10, 51], spain: [-4, 40], portugal: [-8, 39.5],
  italy: [12, 43], greece: [22, 39], russia: [90, 60], egypt: [30, 27], nigeria: [8, 9], kenya: [38, 0], "south africa": [25, -29],
  ethiopia: [39, 9], ghana: [-1, 8], morocco: [-6, 32], algeria: [3, 28], indonesia: [113, -1], pakistan: [70, 30], bangladesh: [90, 24],
  "saudi arabia": [45, 24], iran: [53, 32], iraq: [44, 33], turkey: [35, 39], israel: [35, 31], "south korea": [128, 36], korea: [128, 36],
  "north korea": [127, 40], vietnam: [106, 16], thailand: [101, 15], philippines: [122, 12], malaysia: [102, 4], peru: [-75, -10],
  colombia: [-74, 4], chile: [-71, -35], venezuela: [-66, 7], cuba: [-79, 22], "new zealand": [174, -41], greenland: [-42, 72],
  iceland: [-19, 65], sweden: [15, 62], norway: [10, 62], finland: [26, 64], denmark: [10, 56], ukraine: [31, 49], poland: [19, 52],
  netherlands: [5, 52], belgium: [4.5, 50.5], switzerland: [8, 47], austria: [14, 47.5], "sri lanka": [81, 7], nepal: [84, 28],
  afghanistan: [66, 34], kazakhstan: [67, 48], mongolia: [103, 46], "democratic republic of the congo": [23, -3], congo: [23, -3],
  tanzania: [35, -6], uganda: [32, 1], madagascar: [47, -19], sudan: [30, 15], singapore: [104, 1.3], taiwan: [121, 24],
  // cities
  london: [0, 51.5], paris: [2.3, 48.9], "new york": [-74, 40.7], tokyo: [139.7, 35.7], beijing: [116.4, 39.9], delhi: [77.2, 28.6],
  "new delhi": [77.2, 28.6], mumbai: [72.9, 19], chennai: [80.3, 13.1], bangalore: [77.6, 13], bengaluru: [77.6, 13], kolkata: [88.4, 22.6],
  shanghai: [121.5, 31.2], moscow: [37.6, 55.8], cairo: [31.2, 30], lagos: [3.4, 6.5], nairobi: [36.8, -1.3], sydney: [151.2, -33.9],
  melbourne: [145, -37.8], "los angeles": [-118.2, 34], "san francisco": [-122.4, 37.8], chicago: [-87.6, 41.9], toronto: [-79.4, 43.7],
  "mexico city": [-99.1, 19.4], "sao paulo": [-46.6, -23.5], "rio de janeiro": [-43.2, -22.9], "buenos aires": [-58.4, -34.6],
  berlin: [13.4, 52.5], rome: [12.5, 41.9], madrid: [-3.7, 40.4], dubai: [55.3, 25.3], "hong kong": [114.2, 22.3], seoul: [127, 37.6],
  istanbul: [29, 41], johannesburg: [28, -26.2], "cape town": [18.4, -33.9], jakarta: [106.8, -6.2], bangkok: [100.5, 13.8],
  karachi: [67, 24.9], dhaka: [90.4, 23.8], washington: [-77, 38.9], boston: [-71, 42.4], seattle: [-122.3, 47.6], geneva: [6.1, 46.2],
};

export function findPlace(name: string): readonly [number, number] | undefined {
  return PLACES[name.trim().toLowerCase()];
}
