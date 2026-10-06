import type { StatusTone } from '../components/StatusPill';

/** The two status taxonomies shared by Contracts and Campus (employer.applicationStatus.* /
 * employer.listingStatus.* translation keys) — previously six copy-pasted STATUS_COLOR maps
 * across MyApplicationsScreen, MyListingsScreen, ListingApplicantsScreen,
 * MyCampusApplicationsScreen, MyCampusListingsScreen, CampusApplicantsScreen
 * (docs/UI_AUDIT.md §11.3). One source of truth now. */
export function applicationStatusTone(status: string): StatusTone {
  switch (status) {
    case 'SHORTLISTED':
    case 'HIRED':
      return 'positive';
    case 'REJECTED':
      return 'negative';
    case 'WITHDRAWN':
      return 'neutral';
    default: // APPLIED
      return 'neutral';
  }
}

export function listingStatusTone(status: string): StatusTone {
  switch (status) {
    case 'OPEN':
      return 'positive';
    case 'CANCELLED':
      return 'negative';
    case 'PAUSED':
    case 'FILLED':
    case 'CLOSED':
    default:
      return 'neutral';
  }
}
