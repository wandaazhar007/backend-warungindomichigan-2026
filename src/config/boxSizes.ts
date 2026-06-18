export const BOX_PRESETS = [
  { name: 'XS', lengthIn: 8,  widthIn: 6,  heightIn: 4,  maxWeightLbs: 2  },
  { name: 'S',  lengthIn: 12, widthIn: 9,  heightIn: 6,  maxWeightLbs: 5  },
  { name: 'M',  lengthIn: 14, widthIn: 11, heightIn: 8,  maxWeightLbs: 10 },
  { name: 'L',  lengthIn: 18, widthIn: 14, heightIn: 10, maxWeightLbs: 20 },
  { name: 'XL', lengthIn: 22, widthIn: 18, heightIn: 14, maxWeightLbs: 50 },
] as const;

export type BoxPreset = (typeof BOX_PRESETS)[number];

export function selectBox(totalWeightGrams: number): BoxPreset {
  const lbs = totalWeightGrams / 453.592;
  return BOX_PRESETS.find((b) => lbs <= b.maxWeightLbs) ?? BOX_PRESETS[BOX_PRESETS.length - 1];
}

// DIM weight divisors per carrier
export const DIM_DIVISOR_UPS = 139;   // applies to all UPS packages
export const DIM_DIVISOR_USPS = 166;  // applies only if > 1 cubic foot
