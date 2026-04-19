let clockInterval = null;

function escapeInfoHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

export function initInfoBar() {
  const clockEl = document.getElementById("user-time");
  const dateEl = document.getElementById("user-date");
  const locationEl = document.getElementById("user-location");
  const weatherEl = document.getElementById("user-weather");

  if (!clockEl || !dateEl) return;

  // Initialize Clock
  function updateClock() {
    const now = new Date();
    
    // Time like '10:42 AM'
    clockEl.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    // Date like 'Mon, April 5'
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
  }

  // Run immediately and then every second (guard against double-init)
  updateClock();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateClock, 1000);

  // If no location element, we can skip API calls
  if (!locationEl || !weatherEl) return;

  // Fetch Location
  async function fetchLocationAndWeather() {
    try {
      const geoRes = await fetch("https://get.geojs.io/v1/ip/geo.json");
      if (!geoRes.ok) throw new Error("GeoAPI fail");
      const geoData = await geoRes.json();
      
      const city = geoData.city || "Unknown";
      const airportCode = getAirportCode(city);
      locationEl.innerHTML = `<i class="fas fa-map-marker-alt" title="${escapeInfoHTML(city)}"></i> ${escapeInfoHTML(airportCode)}`;

      const lat = geoData.latitude;
      const lon = geoData.longitude;

      if (!lat || !lon) return;

      // Fetch Weather
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
      if (!weatherRes.ok) throw new Error("WeatherAPI fail");
      const weatherData = await weatherRes.json();

      const current = weatherData.current_weather;
      if (current) {
        const temp = Math.round(current.temperature);
        const code = current.weathercode;
        const weatherObj = getWeatherCode(code);
        
        weatherEl.innerHTML = `<i class="${escapeInfoHTML(weatherObj.icon)} weather-icon" title="${escapeInfoHTML(weatherObj.desc)}"></i> ${escapeInfoHTML(temp)}°C`;
      }

    } catch (e) {
      console.error("InfoBar API Error:", e);
      locationEl.textContent = "🌍 Earth (Remote)";
      weatherEl.textContent = "";
    }
  }

  fetchLocationAndWeather();
}

function getWeatherCode(code) {
  if (code === 0) return { icon: "fas fa-sun", desc: "Clear" };
  if (code === 1 || code === 2 || code === 3) return { icon: "fas fa-cloud-sun", desc: "Partly Cloudy" };
  if (code >= 45 && code <= 48) return { icon: "fas fa-smog", desc: "Fog" };
  if (code >= 51 && code <= 67) return { icon: "fas fa-cloud-rain", desc: "Rain" };
  if (code >= 71 && code <= 77) return { icon: "fas fa-snowflake", desc: "Snow" };
  if (code >= 80 && code <= 82) return { icon: "fas fa-cloud-showers-heavy", desc: "Showers" };
  if (code >= 95 && code <= 99) return { icon: "fas fa-bolt", desc: "Thunderstorm" };
  return { icon: "fas fa-thermometer-half", desc: "Unknown" };
}

function getAirportCode(city) {
  const map = {
    'charlotte': 'CLT',
    'salt lake city': 'SLC',
    'new york': 'NYC',
    'los angeles': 'LAX',
    'chicago': 'ORD',
    'houston': 'IAH',
    'phoenix': 'PHX',
    'philadelphia': 'PHL',
    'san antonio': 'SAT',
    'san diego': 'SAN',
    'dallas': 'DFW',
    'san jose': 'SJC',
    'austin': 'AUS',
    'jacksonville': 'JAX',
    'fort worth': 'DFW',
    'columbus': 'CMH',
    'san francisco': 'SFO',
    'indianapolis': 'IND',
    'seattle': 'SEA',
    'denver': 'DEN',
    'washington': 'IAD',
    'boston': 'BOS',
    'el paso': 'ELP',
    'nashville': 'BNA',
    'detroit': 'DTW',
    'oklahoma city': 'OKC',
    'portland': 'PDX',
    'las vegas': 'LAS',
    'memphis': 'MEM',
    'louisville': 'SDF',
    'baltimore': 'BWI',
    'milwaukee': 'MKE',
    'albuquerque': 'ABQ',
    'tucson': 'TUS',
    'fresno': 'FAT',
    'sacramento': 'SMF',
    'kansas city': 'MCI',
    'mesa': 'AZA',
    'atlanta': 'ATL',
    'omaha': 'OMA',
    'colorado springs': 'COS',
    'raleigh': 'RDU',
    'miami': 'MIA',
    'oakland': 'OAK',
    'minneapolis': 'MSP',
    'tulsa': 'TUL',
    'cleveland': 'CLE',
    'wichita': 'ICT',
    'arlington': 'DCA',
    'new orleans': 'MSY',
    'bakersfield': 'BFL',
    'tampa': 'TPA',
    'honolulu': 'HNL',
    'anaheim': 'SNA',
    'aurora': 'DEN',
    'santa ana': 'SNA',
    'st. louis': 'STL',
    'riverside': 'RAL',
    'corpus christi': 'CRP',
    'lexington': 'LEX',
    'pittsburgh': 'PIT',
    'anchorage': 'ANC',
    'stockton': 'SCK',
    'cincinnati': 'CVG',
    'st. paul': 'MSP',
    'toledo': 'TOL',
    'greensboro': 'GSO',
    'newark': 'EWR',
    'plano': 'DFW',
    'henderson': 'LAS',
    'lincoln': 'LNK',
    'buffalo': 'BUF',
    'jersey city': 'EWR',
    'chula vista': 'SAN',
    'fort wayne': 'FWA',
    'orlando': 'MCO',
    'st. petersburg': 'PIE',
    'chandler': 'PHX',
    'laredo': 'LRD',
    'norfolk': 'ORF',
    'durham': 'RDU',
    'madison': 'MSN',
    'lubbock': 'LBB',
    'irvine': 'SNA',
    'winston-salem': 'INT',
    'glendale': 'PHX',
    'garland': 'DFW',
    'hialeah': 'MIA',
    'reno': 'RNO',
    'chesapeake': 'ORF',
    'gilbert': 'PHX',
    'baton rouge': 'BTR',
    'irving': 'DFW',
    'scottsdale': 'PHX',
    'north las vegas': 'LAS',
    'fremont': 'OAK',
    'boise': 'BOI',
    'richmond': 'RIC',
    'london': 'LHR',
    'paris': 'CDG',
    'tokyo': 'HND',
    'beijing': 'PEK',
    'dubai': 'DXB',
    'sydney': 'SYD',
    'toronto': 'YYZ',
    'vancouver': 'YVR',
    'montreal': 'YUL',
    'frankfurt': 'FRA',
    'amsterdam': 'AMS',
    'madrid': 'MAD',
    'rome': 'FCO',
    'mexico city': 'MEX',
    'mumbai': 'BOM',
    'delhi': 'DEL',
    'singapore': 'SIN',
    'seoul': 'ICN',
    'shanghai': 'PVG',
    'hong kong': 'HKG',
    'bangkok': 'BKK',
    'istanbul': 'IST',
    'sao paulo': 'GRU',
    'buenos aires': 'EZE',
    'johannesburg': 'JNB'
  };

  if (!city || city === "Unknown") return "UNK";

  const normalized = city.toLowerCase().trim();
  if (map[normalized]) {
    return map[normalized];
  }

  // Fallback: generate a 3-letter code
  const parts = normalized.split(/[\s-]/).filter(p => p.length > 0);
  let code = '';
  if (parts.length >= 3) {
    code = parts[0][0] + parts[1][0] + parts[2][0];
  } else if (parts.length === 2) {
    code = parts[0][0] + parts[1][0] + (parts[1][1] || parts[0][1] || 'X');
  } else {
    code = city.replace(/[^a-zA-Z]/g, '').substring(0, 3);
    if (code.length < 3) code = code.padEnd(3, 'X');
  }
  return code.toUpperCase();
}
