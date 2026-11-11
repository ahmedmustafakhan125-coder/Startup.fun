// Countries a founder can pick. `id` is the ISO 3166-1 numeric code used by the map data;
// lat/lng is the main startup hub, which is where the globe puts the marker.
export interface Country {
  name: string
  code: string // ISO alpha-2, shown in badges
  id: string
  lat: number
  lng: number
}

export const COUNTRIES: Country[] = [
  { name: 'Argentina', code: 'AR', id: '032', lat: -34.6, lng: -58.4 },
  { name: 'Australia', code: 'AU', id: '036', lat: -33.9, lng: 151.2 },
  { name: 'Bahrain', code: 'BH', id: '048', lat: 26.2, lng: 50.6 },
  { name: 'Bangladesh', code: 'BD', id: '050', lat: 23.8, lng: 90.4 },
  { name: 'Brazil', code: 'BR', id: '076', lat: -23.5, lng: -46.6 },
  { name: 'Canada', code: 'CA', id: '124', lat: 43.7, lng: -79.4 },
  { name: 'China', code: 'CN', id: '156', lat: 31.2, lng: 121.5 },
  { name: 'Egypt', code: 'EG', id: '818', lat: 30.0, lng: 31.2 },
  { name: 'Estonia', code: 'EE', id: '233', lat: 59.4, lng: 24.7 },
  { name: 'France', code: 'FR', id: '250', lat: 48.9, lng: 2.35 },
  { name: 'Germany', code: 'DE', id: '276', lat: 52.5, lng: 13.4 },
  { name: 'India', code: 'IN', id: '356', lat: 12.97, lng: 77.6 },
  { name: 'Indonesia', code: 'ID', id: '360', lat: -6.2, lng: 106.8 },
  { name: 'Ireland', code: 'IE', id: '372', lat: 53.35, lng: -6.26 },
  { name: 'Italy', code: 'IT', id: '380', lat: 45.46, lng: 9.19 },
  { name: 'Japan', code: 'JP', id: '392', lat: 35.7, lng: 139.7 },
  { name: 'Jordan', code: 'JO', id: '400', lat: 31.95, lng: 35.9 },
  { name: 'Kenya', code: 'KE', id: '404', lat: -1.29, lng: 36.8 },
  { name: 'Kuwait', code: 'KW', id: '414', lat: 29.4, lng: 47.98 },
  { name: 'Malaysia', code: 'MY', id: '458', lat: 3.14, lng: 101.7 },
  { name: 'Mexico', code: 'MX', id: '484', lat: 19.4, lng: -99.1 },
  { name: 'Morocco', code: 'MA', id: '504', lat: 33.6, lng: -7.6 },
  { name: 'Netherlands', code: 'NL', id: '528', lat: 52.37, lng: 4.9 },
  { name: 'Nigeria', code: 'NG', id: '566', lat: 6.52, lng: 3.38 },
  { name: 'Norway', code: 'NO', id: '578', lat: 59.9, lng: 10.75 },
  { name: 'Oman', code: 'OM', id: '512', lat: 23.6, lng: 58.4 },
  { name: 'Pakistan', code: 'PK', id: '586', lat: 31.52, lng: 74.36 },
  { name: 'Philippines', code: 'PH', id: '608', lat: 14.6, lng: 121.0 },
  { name: 'Poland', code: 'PL', id: '616', lat: 52.23, lng: 21.0 },
  { name: 'Portugal', code: 'PT', id: '620', lat: 38.7, lng: -9.14 },
  { name: 'Qatar', code: 'QA', id: '634', lat: 25.29, lng: 51.53 },
  { name: 'Saudi Arabia', code: 'SA', id: '682', lat: 24.7, lng: 46.7 },
  { name: 'Singapore', code: 'SG', id: '702', lat: 1.35, lng: 103.82 },
  { name: 'South Africa', code: 'ZA', id: '710', lat: -33.9, lng: 18.4 },
  { name: 'South Korea', code: 'KR', id: '410', lat: 37.57, lng: 126.98 },
  { name: 'Spain', code: 'ES', id: '724', lat: 40.4, lng: -3.7 },
  { name: 'Sweden', code: 'SE', id: '752', lat: 59.33, lng: 18.07 },
  { name: 'Türkiye', code: 'TR', id: '792', lat: 41.0, lng: 28.98 },
  { name: 'United Arab Emirates', code: 'AE', id: '784', lat: 25.2, lng: 55.27 },
  { name: 'United Kingdom', code: 'GB', id: '826', lat: 51.5, lng: -0.12 },
  { name: 'United States', code: 'US', id: '840', lat: 37.77, lng: -122.42 },
  { name: 'Vietnam', code: 'VN', id: '704', lat: 10.8, lng: 106.7 },
]

const byName = new Map(COUNTRIES.map(c => [c.name, c]))
export const countryOf = (name: string): Country | undefined => byName.get(name)
