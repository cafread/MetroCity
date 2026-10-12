export const openBorders: Record<string, string[]> = {
    "AL": ["GR", "MK", "ME", "XK"],
    "AT": ["DE", "CZ", "SK", "HU", "SI", "IT", "CH", "LI"],
    "AD": ["FR", "ES"],
    "AX": ["FI"],
    "BA": ["HR", "ME", "RS"],
    "BE": ["FR", "NL", "DE", "LU"],
    "BG": ["RO", "RS", "MK", "GR"],
    "BY": ["LT", "LV", "PL"],
    "CH": ["FR", "DE", "AT", "IT", "LI"],
    "CZ": ["DE", "PL", "SK", "AT"],
    "DE": ["DK", "NL", "BE", "LU", "FR", "CH", "AT", "CZ", "PL"],
    "DK": ["DE"],
    "EE": ["LV"],
    "ES": ["PT", "FR", "GI", "AD"],
    "FI": ["NO", "SE", "AX"],
    "FR": ["BE", "LU", "DE", "CH", "IT", "MC", "ES", "AD"],
    "GB": ["IE"],
    "GI": ["ES"],
    "GR": ["AL", "MK", "BG"],
    "HR": ["SI", "HU", "RS", "BA", "ME", "IT"],
    "HU": ["AT", "SK", "RO", "RS", "HR", "SI"],
    "IE": ["GB"],
    "IT": ["FR", "CH", "AT", "SI", "SM", "VA", "HR"],
    "LI": ["CH", "AT"],
    "LT": ["LV", "BY", "PL"],
    "LU": ["BE", "FR", "DE"],
    "LV": ["EE", "LT", "BY"],
    "MC": ["FR"],
    "ME": ["HR", "BA", "RS", "XK", "AL"],
    "MK": ["AL", "GR", "BG", "RS", "XK"],
    "NL": ["BE", "DE"],
    "NO": ["FI", "SE"],
    "PL": ["DE", "CZ", "SK", "LT", "BY"],
    "PT": ["ES"],
    "RO": ["BG", "RS", "HU"],
    "RS": ["HR", "BA", "HU", "RO", "BG", "MK", "XK", "ME"],
    "SE": ["NO", "FI"],
    "SI": ["IT", "AT", "HU", "HR"],
    "SK": ["CZ", "PL", "HU", "AT"],
    "SM": ["IT"],
    "VA": ["IT"],
    "XK": ["RS", "ME", "AL", "MK"],
    "IN": ["NP"],
    "NP": ["IN"],
    "BR": ["AR"],
    "AR": ["BR"],
    "MF": ["SX"],
    "SX": ["MF"]
};

export function validateBorder(cc: string, cityCc: string, city: string): string {
    if (cc === "SG") return "Singapore, SG";
    if (cc === "HK") return "Hong Kong, HK";
    if (cc === "MO") return "Macau, (MO), CN";
    if (cc === "MY" && cityCc === "SG") return "Johor Bahru, MY";
    if (cc === cityCc) return city;
    if (openBorders[cc]?.includes(cityCc)) return city;
    if (cc === "CG" && city === "Kinshasa, CD") return "Brazzaville, CG";
    if (cc === "MX" && city === "San Diego, (CA), US") return "Tijuana, MX";
    if (cc === "US" && city === "Juarez, MX") return "El Paso, (TX), US";
    if (cc === "US" && city === "Hamilton, (ON), CA") return "Buffalo, (NY), US";
    if (cc === "US" && city === "Windsor, (ON), CA") return "Detroit, (MI), US";
    if (cc === "US" && city === "London, (ON), CA") return "Detroit, (MI), US";
    if (cc === "CA" && city === "Detroit, (MI), US") return "Windsor, (ON), CA";
    if (cc === "CN" && city === "Hong Kong, HK") return "Shenzhen, (GD), CN";
    if (cc === "TR" && city === "Nicosia, CY") return city;
    return "";
}
