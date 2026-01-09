
 


export interface MapInfo {
  name: string;
  heightlimit: number;
  maxplayers: number;
  locked?: boolean;
  reserved?: boolean;
}

export interface MapsJsonPayload {
  type: 'maps_info';
  reserved: Array<Partial<MapInfo> & { name: string; maxplayers?: number; max_players?: number; }>;
  locked: Array<Partial<MapInfo> & { name: string; maxplayers?: number; max_players?: number; }>;
  disabled: Array<Partial<MapInfo> & { name: string; maxplayers?: number; max_players?: number; }>;
  all?: Array<Partial<MapInfo> & { name: string; maxplayers?: number; max_players?: number; }>;
}