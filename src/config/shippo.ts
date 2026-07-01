import axios from 'axios';

const SHIPPO_BASE_URL = 'https://api.goshippo.com';

export const shippoClient = axios.create({
  baseURL: SHIPPO_BASE_URL,
  headers: {
    Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

export interface ShippoAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface ShippoParcel {
  length: string;
  width: string;
  height: string;
  distance_unit: 'in' | 'cm';
  weight: string;
  mass_unit: 'lb' | 'kg' | 'g' | 'oz';
}

export interface ShippoRate {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  provider_image_75: string;
  servicelevel: {
    name: string;
    token: string;
  };
  estimated_days: number | null;
  duration_terms: string | null;
  attributes: string[];
}

export interface ShippoShipmentResponse {
  object_id: string;
  status: string;
  rates: ShippoRate[];
}

export async function getShippingRates(
  addressTo: ShippoAddress,
  parcel: ShippoParcel
): Promise<ShippoRate[]> {
  const addressFrom: ShippoAddress = {
    name: process.env.WIM_ORIGIN_NAME ?? 'Warung IndoMi',
    street1: process.env.WIM_ORIGIN_STREET1 ?? '',
    city: process.env.WIM_ORIGIN_CITY ?? 'Madison Heights',
    state: process.env.WIM_ORIGIN_STATE ?? 'MI',
    zip: process.env.WIM_ORIGIN_ZIP ?? '48071',
    country: process.env.WIM_ORIGIN_COUNTRY ?? 'US',
    phone: process.env.WIM_ORIGIN_PHONE,
  };

  const { data } = await shippoClient.post<ShippoShipmentResponse>('/shipments/', {
    address_from: addressFrom,
    address_to: addressTo,
    parcels: [parcel],
    async: false,
  });

  // Return only rates in USD, sorted by price ascending
  return data.rates
    .filter((r) => r.currency === 'USD')
    .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
}
