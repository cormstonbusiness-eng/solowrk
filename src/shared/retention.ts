/**
 * How long a deleted thing is kept before it is really gone.
 *
 * Shared because the trash page says the number out loud and the service
 * enforces it, and a screen promising thirty days over a sweep that takes
 * seven would be a lie the user only discovers by losing something.
 *
 * Thirty days is the span over which somebody notices a mistake — a quarter's
 * invoicing, the next VAT return. Past that the trash is only a second copy of
 * things nobody wanted.
 */
export const RETENTION_DAYS = 30
