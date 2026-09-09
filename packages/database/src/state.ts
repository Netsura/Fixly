import { BookingStatus, PaymentStatus, RequestStatus } from '@prisma/client';

/**
 * Single source of truth for lifecycle transitions.
 *
 * Every booking/request/payment status change must be validated here so the
 * rules cannot drift between the bookings service, payments service, and
 * background reconciliation.
 */

export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PAYMENT_PENDING]: [BookingStatus.PAID, BookingStatus.CANCELLED],
  [BookingStatus.PAID]: [BookingStatus.SCHEDULED, BookingStatus.CANCELLED],
  [BookingStatus.SCHEDULED]: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED],
  [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
};

export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.DRAFT]: [RequestStatus.PUBLISHED, RequestStatus.CANCELLED],
  [RequestStatus.PUBLISHED]: [RequestStatus.OFFER_RECEIVED, RequestStatus.CANCELLED],
  [RequestStatus.OFFER_RECEIVED]: [RequestStatus.PROVIDER_SELECTED, RequestStatus.PAYMENT_PENDING, RequestStatus.CANCELLED],
  [RequestStatus.PROVIDER_SELECTED]: [RequestStatus.PAYMENT_PENDING, RequestStatus.PAID, RequestStatus.CANCELLED],
  [RequestStatus.PAYMENT_PENDING]: [RequestStatus.PAID, RequestStatus.CANCELLED],
  [RequestStatus.PAID]: [RequestStatus.SCHEDULED, RequestStatus.CANCELLED],
  [RequestStatus.SCHEDULED]: [RequestStatus.IN_PROGRESS, RequestStatus.CANCELLED],
  [RequestStatus.IN_PROGRESS]: [RequestStatus.COMPLETED],
  [RequestStatus.COMPLETED]: [RequestStatus.REVIEWED, RequestStatus.CANCELLED],
  [RequestStatus.REVIEWED]: [],
  [RequestStatus.CANCELLED]: [],
};

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED],
  [PaymentStatus.SUCCEEDED]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [PaymentStatus.PENDING],
  [PaymentStatus.REFUNDED]: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus) {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionRequest(from: RequestStatus, to: RequestStatus) {
  return REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus) {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Statuses that may legally move into `to`. Used to build conditional updates
 * (`where: { status: { in: sources } }`) so a concurrent writer cannot slip a
 * state change past the check.
 */
export function bookingSourcesFor(to: BookingStatus): BookingStatus[] {
  return (Object.keys(BOOKING_TRANSITIONS) as BookingStatus[]).filter((from) => canTransitionBooking(from, to));
}

export function requestSourcesFor(to: RequestStatus): RequestStatus[] {
  return (Object.keys(REQUEST_TRANSITIONS) as RequestStatus[]).filter((from) => canTransitionRequest(from, to));
}

export function paymentSourcesFor(to: PaymentStatus): PaymentStatus[] {
  return (Object.keys(PAYMENT_TRANSITIONS) as PaymentStatus[]).filter((from) => canTransitionPayment(from, to));
}

/** Request status that mirrors a given booking status. */
export const BOOKING_TO_REQUEST_STATUS: Record<BookingStatus, RequestStatus> = {
  [BookingStatus.PAYMENT_PENDING]: RequestStatus.PAYMENT_PENDING,
  [BookingStatus.PAID]: RequestStatus.PAID,
  [BookingStatus.SCHEDULED]: RequestStatus.SCHEDULED,
  [BookingStatus.IN_PROGRESS]: RequestStatus.IN_PROGRESS,
  [BookingStatus.COMPLETED]: RequestStatus.COMPLETED,
  [BookingStatus.CANCELLED]: RequestStatus.CANCELLED,
};
