"""Country -> region lookup used for geography tagging and CIM parsing."""

REGIONS = {
    "North America": [
        "United States", "Canada", "Mexico",
    ],
    "Latin America": [
        "Brazil", "Argentina", "Chile", "Colombia", "Peru", "Uruguay", "Costa Rica",
        "Panama", "Ecuador", "Guatemala", "Dominican Republic", "Puerto Rico",
    ],
    "UK & Ireland": [
        "United Kingdom", "Ireland",
    ],
    "DACH": [
        "Germany", "Austria", "Switzerland",
    ],
    "Nordics": [
        "Sweden", "Norway", "Denmark", "Finland", "Iceland",
    ],
    "Western Europe": [
        "France", "Netherlands", "Belgium", "Luxembourg", "Spain", "Portugal",
        "Italy", "Monaco", "Malta", "Greece", "Cyprus",
    ],
    "Central & Eastern Europe": [
        "Poland", "Czech Republic", "Slovakia", "Hungary", "Romania", "Bulgaria",
        "Croatia", "Slovenia", "Serbia", "Estonia", "Latvia", "Lithuania",
        "Ukraine", "Turkey",
    ],
    "Middle East & Africa": [
        "United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman",
        "Israel", "Egypt", "Morocco", "South Africa", "Nigeria", "Kenya", "Ghana",
        "Jordan",
    ],
    "Asia-Pacific": [
        "China", "Hong Kong", "Japan", "South Korea", "Taiwan", "Singapore", "India",
        "Indonesia", "Malaysia", "Thailand", "Vietnam", "Philippines", "Australia",
        "New Zealand", "Pakistan", "Bangladesh",
    ],
}

COUNTRY_TO_REGION = {c: r for r, cs in REGIONS.items() for c in cs}

# Alternate spellings found in documents -> canonical country name.
ALIASES = {
    "USA": "United States", "U.S.": "United States", "U.S.A.": "United States",
    "US": "United States", "United States of America": "United States", "America": "United States",
    "UK": "United Kingdom", "U.K.": "United Kingdom", "Great Britain": "United Kingdom",
    "Britain": "United Kingdom", "England": "United Kingdom", "Scotland": "United Kingdom",
    "Wales": "United Kingdom", "Northern Ireland": "United Kingdom",
    "UAE": "United Arab Emirates", "Dubai": "United Arab Emirates", "Abu Dhabi": "United Arab Emirates",
    "Holland": "Netherlands", "The Netherlands": "Netherlands",
    "Korea": "South Korea", "Republic of Korea": "South Korea",
    "Czechia": "Czech Republic", "Türkiye": "Turkey", "PRC": "China", "Mainland China": "China",
    "KSA": "Saudi Arabia",
}

US_STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH",
    "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN",
    "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
US_STATE_CODES = set(US_STATES.values())

CA_PROVINCES = [
    "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan",
    "Nova Scotia", "New Brunswick",
]

ALL_COUNTRIES = sorted(COUNTRY_TO_REGION)


def canonical_country(name):
    if not name:
        return None
    name = name.strip().strip(".,;")
    if name in COUNTRY_TO_REGION:
        return name
    if name in ALIASES:
        return ALIASES[name]
    if name in US_STATES or name in US_STATE_CODES:
        return "United States"
    if name in CA_PROVINCES:
        return "Canada"
    lowered = {c.lower(): c for c in COUNTRY_TO_REGION}
    return lowered.get(name.lower())


def region_for(country):
    c = canonical_country(country)
    return COUNTRY_TO_REGION.get(c) if c else None
