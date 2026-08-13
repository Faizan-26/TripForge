from math import asin, cos, radians, sin, sqrt

from app.schemas.common import Coordinates


def haversine_km(first: Coordinates, second: Coordinates) -> float:
    earth_radius_km = 6371.0088
    lat1, lon1, lat2, lon2 = map(
        radians,
        (first.latitude, first.longitude, second.latitude, second.longitude),
    )
    delta_latitude = lat2 - lat1
    delta_longitude = lon2 - lon1
    value = (
        sin(delta_latitude / 2) ** 2
        + cos(lat1) * cos(lat2) * sin(delta_longitude / 2) ** 2
    )
    return earth_radius_km * 2 * asin(sqrt(value))
