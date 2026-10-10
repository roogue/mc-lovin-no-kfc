// Shared settings for every page. The API address lives here only.
//   baseUrl        the Plant Check backend (Backend/app.py)
//   pollSeconds    how often the dashboard polls the latest reading and relay state
//   defaultSource  "live" | "sample": what the pages show until the simulation page's remote picks one
window.API_CONFIG = {
	baseUrl: "https://api.putrinaqibah.com",
	pollSeconds: 2,
	defaultSource: "live",
};
