from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.dependencies import get_current_user, get_maps_client
from app.supabase import AuthenticatedUser
from app.tools.google_maps import ExternalProviderError, GoogleMapsClient

router = APIRouter(prefix="/api/v1/places", tags=["places"])


@router.get("/photos")
async def get_place_photo(
    maps: Annotated[GoogleMapsClient, Depends(get_maps_client)],
    _user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    name: Annotated[str, Query(min_length=20, max_length=1000)],
    width: Annotated[int, Query(ge=1, le=1600)] = 1200,
    height: Annotated[int, Query(ge=1, le=1200)] = 900,
) -> Response:
    try:
        media = await maps.get_photo_media(
            name,
            max_width_px=width,
            max_height_px=height,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ExternalProviderError as exc:
        raise HTTPException(status_code=502, detail="Google photo is unavailable") from exc
    return Response(
        content=media.content,
        media_type=media.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "private, no-store"},
    )
