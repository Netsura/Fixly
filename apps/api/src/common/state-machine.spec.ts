import {
  BOOKING_TO_REQUEST_STATUS,
  BookingStatus,
  bookingSourcesFor,
  canTransitionBooking,
  canTransitionPayment,
  canTransitionRequest,
  PaymentStatus,
  paymentSourcesFor,
  RequestStatus,
  requestSourcesFor,
} from '@fixly/database';

describe('booking transitions', () => {
  it('follows the happy path', () => {
    expect(canTransitionBooking(BookingStatus.PAYMENT_PENDING, BookingStatus.PAID)).toBe(true);
    expect(canTransitionBooking(BookingStatus.PAID, BookingStatus.SCHEDULED)).toBe(true);
    expect(canTransitionBooking(BookingStatus.SCHEDULED, BookingStatus.IN_PROGRESS)).toBe(true);
    expect(canTransitionBooking(BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED)).toBe(true);
  });

  it('rejects skipping payment', () => {
    expect(canTransitionBooking(BookingStatus.PAYMENT_PENDING, BookingStatus.SCHEDULED)).toBe(false);
    expect(canTransitionBooking(BookingStatus.PAYMENT_PENDING, BookingStatus.COMPLETED)).toBe(false);
  });

  it('treats completed and cancelled as terminal', () => {
    for (const target of Object.values(BookingStatus)) {
      expect(canTransitionBooking(BookingStatus.COMPLETED, target)).toBe(false);
      expect(canTransitionBooking(BookingStatus.CANCELLED, target)).toBe(false);
    }
  });

  it('does not allow a job in progress to be cancelled', () => {
    expect(canTransitionBooking(BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED)).toBe(false);
  });

  it('never reports a self-transition as legal', () => {
    for (const status of Object.values(BookingStatus)) {
      expect(canTransitionBooking(status, status)).toBe(false);
    }
  });

  it('derives source states consistent with the transition table', () => {
    for (const target of Object.values(BookingStatus)) {
      for (const source of bookingSourcesFor(target)) {
        expect(canTransitionBooking(source, target)).toBe(true);
      }
    }
    expect(bookingSourcesFor(BookingStatus.PAID)).toEqual([BookingStatus.PAYMENT_PENDING]);
    expect(bookingSourcesFor(BookingStatus.CANCELLED)).toEqual([
      BookingStatus.PAYMENT_PENDING,
      BookingStatus.PAID,
      BookingStatus.SCHEDULED,
    ]);
  });

  it('maps every booking status onto a request status', () => {
    for (const status of Object.values(BookingStatus)) {
      expect(BOOKING_TO_REQUEST_STATUS[status]).toBeDefined();
    }
  });
});

describe('request transitions', () => {
  it('requires publishing before offers arrive', () => {
    expect(canTransitionRequest(RequestStatus.DRAFT, RequestStatus.PUBLISHED)).toBe(true);
    expect(canTransitionRequest(RequestStatus.DRAFT, RequestStatus.OFFER_RECEIVED)).toBe(false);
  });

  it('allows cancelling only before the work is finished', () => {
    expect(canTransitionRequest(RequestStatus.PUBLISHED, RequestStatus.CANCELLED)).toBe(true);
    expect(canTransitionRequest(RequestStatus.SCHEDULED, RequestStatus.CANCELLED)).toBe(true);
    expect(canTransitionRequest(RequestStatus.IN_PROGRESS, RequestStatus.CANCELLED)).toBe(false);
    expect(canTransitionRequest(RequestStatus.REVIEWED, RequestStatus.CANCELLED)).toBe(false);
  });

  it('only accepts a review once the job is complete', () => {
    expect(canTransitionRequest(RequestStatus.COMPLETED, RequestStatus.REVIEWED)).toBe(true);
    expect(canTransitionRequest(RequestStatus.IN_PROGRESS, RequestStatus.REVIEWED)).toBe(false);
    expect(requestSourcesFor(RequestStatus.REVIEWED)).toEqual([RequestStatus.COMPLETED]);
  });

  it('does not allow a second offer to reset an accepted request', () => {
    expect(canTransitionRequest(RequestStatus.PROVIDER_SELECTED, RequestStatus.OFFER_RECEIVED)).toBe(false);
    expect(canTransitionRequest(RequestStatus.PAID, RequestStatus.OFFER_RECEIVED)).toBe(false);
    expect(requestSourcesFor(RequestStatus.OFFER_RECEIVED)).toEqual([RequestStatus.PUBLISHED]);
  });

  it('treats reviewed as terminal', () => {
    for (const target of Object.values(RequestStatus)) {
      expect(canTransitionRequest(RequestStatus.REVIEWED, target)).toBe(false);
    }
  });
});

describe('payment transitions', () => {
  it('settles from pending only', () => {
    expect(canTransitionPayment(PaymentStatus.PENDING, PaymentStatus.SUCCEEDED)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.PENDING, PaymentStatus.FAILED)).toBe(true);
    expect(paymentSourcesFor(PaymentStatus.SUCCEEDED)).toEqual([PaymentStatus.PENDING]);
  });

  it('never re-succeeds or un-refunds a payment', () => {
    expect(canTransitionPayment(PaymentStatus.SUCCEEDED, PaymentStatus.SUCCEEDED)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.SUCCEEDED, PaymentStatus.FAILED)).toBe(false);
    expect(canTransitionPayment(PaymentStatus.REFUNDED, PaymentStatus.SUCCEEDED)).toBe(false);
  });

  it('refunds only a succeeded payment', () => {
    expect(canTransitionPayment(PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED)).toBe(true);
    expect(canTransitionPayment(PaymentStatus.PENDING, PaymentStatus.REFUNDED)).toBe(false);
    expect(paymentSourcesFor(PaymentStatus.REFUNDED)).toEqual([PaymentStatus.SUCCEEDED]);
  });
});
