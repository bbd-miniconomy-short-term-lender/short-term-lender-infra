const ADMIN_PORTAL_URL = 'https://loans.projects.bbdgrad.com/'
const API_URL = 'https://api.loans.projects.bbdgrad.com/'

const LOGIN_URL = `https://bbdloans.auth.eu-west-1.amazoncognito.com/login?client_id=5m671l5io0gcnnvlru34784ac2&response_type=token&scope=email+openid+profile&redirect_uri=${ADMIN_PORTAL_URL}`;
const LOGOUT_URL = `https://bbdloans.auth.eu-west-1.amazoncognito.com/logout?client_id=5m671l5io0gcnnvlru34784ac2&response_type=token&scope=email+openid+profile&redirect_uri=${ADMIN_PORTAL_URL}`;

export { API_URL, LOGIN_URL, LOGOUT_URL }