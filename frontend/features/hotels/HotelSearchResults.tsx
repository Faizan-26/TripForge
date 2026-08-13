"use client";

import { useState } from "react";
import type {
  HotelImage,
  HotelPropertyCandidate,
  HotelSearchResult,
} from "@/lib/trip-api/types";
import styles from "@/app/chat/new/chat.module.css";

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function MapPinIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></svg>;
}

function StarIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>;
}

function ChevronIcon({ direction }: { direction: "previous" | "next" }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={direction === "previous" ? "m15 18-6-6 6-6" : "m9 6 6 6-6 6"} />
  </svg>;
}

function PhotoAttribution({ image }: { image: HotelImage }) {
  return <figcaption>
    Photo{image.attribution ? " by " : " from "}
    {image.attribution_url
      ? <a href={image.attribution_url} target="_blank" rel="noreferrer">{image.attribution}</a>
      : image.attribution ?? "Google Places"}
    {image.google_maps_uri && <> · <a href={image.google_maps_uri} target="_blank" rel="noreferrer">View source</a></>}
  </figcaption>;
}

function PropertyPreview({ property }: { property: HotelPropertyCandidate }) {
  const images = property.images.filter((image) => image.source?.provider === "google_places");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = images[activeIndex];

  function show(index: number) {
    setActiveIndex((index + images.length) % images.length);
  }

  if (activeImage) {
    return <figure className={`${styles.hotelPreview} ${styles.hotelGallery}`} aria-label={`${property.name} photo gallery`}>
      <span className={styles.hotelPhotoFallback}>{property.name.slice(0, 2).toUpperCase()}</span>
      {/* Only the active photo is mounted, so later photos are fetched on navigation. */}
      {/* Google photo URLs are authenticated by TripForge's same-origin proxy. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={activeImage.id ?? activeImage.url}
        src={activeImage.url}
        alt={activeImage.alt_text ?? `${property.name} property photo ${activeIndex + 1}`}
        loading="lazy"
        decoding="async"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
      {images.length > 1 && <>
        <button className={`${styles.hotelGalleryButton} ${styles.hotelGalleryPrevious}`} type="button" onClick={() => show(activeIndex - 1)} aria-label={`Previous photo of ${property.name}`}>
          <ChevronIcon direction="previous" />
        </button>
        <button className={`${styles.hotelGalleryButton} ${styles.hotelGalleryNext}`} type="button" onClick={() => show(activeIndex + 1)} aria-label={`Next photo of ${property.name}`}>
          <ChevronIcon direction="next" />
        </button>
        <div className={styles.hotelGalleryPosition} aria-live="polite">{activeIndex + 1} / {images.length}</div>
        <div className={styles.hotelGalleryDots} aria-label="Choose property photo">
          {images.map((image, index) => <button key={image.id ?? image.url} type="button" className={index === activeIndex ? styles.hotelGalleryDotActive : ""} onClick={() => show(index)} aria-label={`Show photo ${index + 1}`} aria-current={index === activeIndex ? "true" : undefined} />)}
        </div>
      </>}
      <PhotoAttribution image={activeImage} />
    </figure>;
  }
  return <div className={styles.hotelPreview} aria-label={`Preview for ${property.name}`}>
    <span>{property.name.slice(0, 2).toUpperCase()}</span>
    <svg viewBox="0 0 220 116" aria-hidden="true">
      <path d="M-8 92c37-36 60-29 84-5 25 25 45 18 70-9 23-24 51-20 83 8" />
      <circle cx="42" cy="73" r="5" />
      <circle cx="170" cy="60" r="5" />
    </svg>
    <small>Property imagery placeholder</small>
  </div>;
}

function PropertyDetails({ property }: { property: HotelPropertyCandidate }) {
  const hours = property.opening_hours;
  const phone = property.international_phone_number ?? property.national_phone_number;
  const reviews = property.reviews ?? [];
  return <details className={styles.hotelDetails}>
    <summary>Reviews &amp; property details</summary>
    <div className={styles.hotelDetailGrid}>
      <section aria-labelledby={`about-${property.property_id}`}>
        <h4 id={`about-${property.property_id}`}>About</h4>
        {property.description
          ? <p>{property.description}</p>
          : <p>Google Places has not published an editorial description for this property.</p>}
        <dl className={styles.hotelFacts}>
          {property.business_status && <><dt>Status</dt><dd>{property.business_status.replaceAll("_", " ").toLowerCase()}</dd></>}
          {phone && <><dt>Phone</dt><dd><a href={`tel:${phone}`}>{phone}</a></dd></>}
          {property.website_uri && <><dt>Website</dt><dd><a href={property.website_uri} target="_blank" rel="noreferrer">Official property website</a></dd></>}
        </dl>
      </section>
      <section aria-labelledby={`hours-${property.property_id}`}>
        <h4 id={`hours-${property.property_id}`}>Published hours</h4>
        {hours ? <>
          {hours.open_now != null && <p className={hours.open_now ? styles.hotelOpen : styles.hotelClosed}>{hours.open_now ? "Open now" : "Closed now"}</p>}
          {hours.weekday_descriptions.length > 0
            ? <ul className={styles.hotelHours}>{hours.weekday_descriptions.map((line) => <li key={line}>{line}</li>)}</ul>
            : <p>Detailed hours are not published.</p>}
        </> : <p>Hotel access and front-desk hours are not published by Google for this property. Confirm check-in and check-out times with the hotel.</p>}
      </section>
    </div>
    <section className={styles.hotelReviewSection} aria-labelledby={`reviews-${property.property_id}`}>
      <h4 id={`reviews-${property.property_id}`}>Google review excerpts</h4>
      {reviews.length > 0 ? <div className={styles.hotelReviews}>
        {reviews.map((review) => <article key={review.review_id}>
          <header>
            {review.author_photo_uri && <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={review.author_photo_uri} alt="" referrerPolicy="no-referrer" />
            </>}
            <div>
              {review.author_uri
                ? <a href={review.author_uri} target="_blank" rel="noreferrer">{review.author_name ?? "Google reviewer"}</a>
                : <strong>{review.author_name ?? "Google reviewer"}</strong>}
              <small>{review.rating.toFixed(1)} / 5{review.relative_publish_time_description ? ` · ${review.relative_publish_time_description}` : ""}</small>
            </div>
          </header>
          {review.text && <p>{review.text}</p>}
          {review.google_maps_uri && <a href={review.google_maps_uri} target="_blank" rel="noreferrer">Read on Google Maps</a>}
        </article>)}
      </div> : <p className={styles.hotelNoReviews}>Google returned the overall rating but no review excerpts for this search.</p>}
    </section>
  </details>;
}

export function HotelSearchResults({
  result,
  disabled,
  onSelect,
}: {
  result: HotelSearchResult;
  disabled: boolean;
  onSelect: (property: HotelPropertyCandidate) => void;
}) {
  const destination = result.constraints.destination_query
    ?? result.constraints.location?.label
    ?? "your search area";

  return <section className={styles.hotelResults} aria-labelledby={`hotel-results-${result.search_id}`}>
    <header className={styles.hotelResultsHeader}>
      <div>
        <h2 id={`hotel-results-${result.search_id}`}>Stays near {destination}</h2>
        <p>{result.properties.length} Google-grounded propert{result.properties.length === 1 ? "y" : "ies"} ready to compare.</p>
      </div>
      <span className={styles.demoBadge}>Demo rates</span>
    </header>

    {result.properties.length > 0 ? <div className={styles.hotelList}>
      {result.properties.map((property) => {
        const offer = property.offers[0];
        const pricing = offer?.pricing;
        const review = property.review_summary;
        const location = property.location.formatted_address ?? property.location.label;
        return <article className={styles.hotelCard} key={property.property_id}>
          <PropertyPreview property={property} />
          <div className={styles.hotelCardBody}>
            <div className={styles.hotelIdentity}>
              <div>
                <h3>{property.name}</h3>
                <p><MapPinIcon />{location}</p>
              </div>
              {review && <div className={styles.hotelRating} aria-label={`${review.rating} out of ${review.scale}, ${review.review_count} reviews`}>
                <StarIcon /><strong>{review.rating}</strong><small>{review.review_count} reviews</small>
              </div>}
            </div>

            <div className={styles.hotelAmenities} aria-label="Amenities">
              {property.amenities.slice(0, 6).map((amenity) => <span key={`${amenity.source?.provider}-${amenity.code}`} title={amenity.details ?? undefined}>{amenity.name}{amenity.source?.provider === "tripvlog_dummy" ? " · demo" : ""}</span>)}
            </div>

            <footer className={styles.hotelCardFooter}>
              {pricing?.total && <div className={styles.hotelPrice}>
                  <span>Estimated stay total</span>
                  <strong>{formatMoney(pricing.total.amount, pricing.total.currency)}</strong>
                  <small>{pricing.nightly_rate ? `${formatMoney(pricing.nightly_rate.amount, pricing.nightly_rate.currency)} nightly` : "Demo price"}{offer.refundable ? " · Refundable" : ""}</small>
              </div>}
              <div className={styles.hotelActions}>
                {property.location.google_maps_uri && <a href={property.location.google_maps_uri} target="_blank" rel="noreferrer">View map</a>}
                <button type="button" disabled={disabled} onClick={() => onSelect(property)}>
                  {disabled ? "Planning…" : "Choose and plan"}
                </button>
              </div>
            </footer>
          </div>
          <PropertyDetails property={property} />
        </article>;
      })}
    </div> : <div className={styles.hotelEmpty}>
      <strong>No grounded properties found</strong>
      <p>Try a nearby landmark, neighborhood, or city.</p>
    </div>}

    <p className={styles.hotelDisclosure}>Names, locations, Google photos, review excerpts, published hours, contact details, and Maps links come from Google Places when available. Star class, demo-labeled amenities, prices, and availability are TripVlog-shaped test data and are not bookable.</p>
  </section>;
}
