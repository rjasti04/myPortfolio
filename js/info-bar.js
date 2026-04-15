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
    
    // Time like '10:42:05 AM'
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Date like 'Monday, April 5'
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
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
      const country = geoData.country || "";
      locationEl.innerHTML = `<i class="fas fa-map-marker-alt"></i> ${escapeInfoHTML(city)}, ${escapeInfoHTML(country)}`;

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

