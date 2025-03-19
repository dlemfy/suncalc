let timeChart, angleChart;
let currentE = parseFloat(document.getElementById('Intensyvity').value).toFixed(2) || 6*1000/24;
let currentPsi = 0.15;
let currentA = document.getElementById('Albedo').value || 0.2;
let marker = null; 

async function onDateChange() {
  let lat, lng;
  if (marker) {
    const latlng = marker.getLatLng();
    lat = latlng.lat;
    lng = latlng.lng;
  } else {
    lat = parseFloat(document.getElementById('phi').value) || 48;
    lng = 31.0;
  }
  await loadHistoricalData(lat, lng);
}

function initMap() {
  const map = L.map('map').setView([48.45, 31.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  
  map.on('click', async (e) => {
      if (marker) { 
          map.removeLayer(marker);
      }
      marker = L.marker(e.latlng).addTo(map);
      document.getElementById('phi').value = e.latlng.lat.toFixed(2);
      await loadHistoricalData(e.latlng.lat, e.latlng.lng);
  });
}

async function loadHistoricalData(lat, lng) {
  const dateInput = document.getElementById('date').value;
  const [day, month, selectedYear] = dateInput.split('.').map(Number);
  
  const targetYears = selectedYear > 2023 ? [2021, 2022, 2023] : [selectedYear];
  
  const pad = v => String(v).padStart(2, '0');
  let totalRadiation = 0;
  let validYears = 0;
  let albedoValue; 

  try {
      const responses = await Promise.all(targetYears.map(year => {
          const dateStr = `${year}${pad(month)}${pad(day)}`;
          
          const tempDate = new Date(year, month-1, day);
          if (tempDate.getMonth()+1 !== month || tempDate.getDate() !== day) {
              console.warn(`Некорректна дата для року ${year}: ${day}.${month}`);
              return null;
          }

          return fetch(
              `https://power.larc.nasa.gov/api/temporal/daily/point?` +
              `parameters=CLRSKY_SFC_SW_DWN,ALLSKY_SRF_ALB&` +
              `start=${dateStr}&end=${dateStr}&` +
              `latitude=${lat.toFixed(6)}&longitude=${lng.toFixed(6)}&` +
              `format=JSON&community=RE`
          );
      }));

      for (const [index, response] of responses.entries()) {
          if (!response) continue;
          
          if (response.ok) {
              const data = await response.json();
              const year = targetYears[index];
              const radiationKey = `${year}${pad(month)}${pad(day)}`;
              const value = data?.properties?.parameter?.CLRSKY_SFC_SW_DWN[radiationKey];
              
              if (value !== undefined && value !== null) {
                  totalRadiation += value;
                  validYears++;
                  albedoValue = data.properties.parameter.ALLSKY_SRF_ALB[radiationKey];
              }
          }
      }
        
      if (validYears > 0) {
          currentE = (totalRadiation / validYears) * 100;
          currentA = albedoValue !== undefined ? albedoValue : 0.2;
          if (selectedYear > 2023) {
              console.log(`Використано середнє за ${validYears} із 3 років: ${currentE.toFixed(2)} Вт/м²`);
          }
      } else {
          currentE = 8 * 100;
          currentA = 0.2;
          console.warn('Немає даних за вказані роки, використовується значення за замовчуванням');
      }

  } catch (error) {
      console.error('Помилка завантаження:', error);
      currentE = 8 * 100;
      currentA = 0.2;
  }
  document.getElementById('Intensyvity').value = currentE.toFixed(2);
  document.getElementById('Albedo').value = currentA.toFixed(2);
}

function calculateDayOfYear(dateStr) {
  const [day, month, year] = dateStr.split('.').map(Number);
  const date = new Date(year, month - 1, day);
  const start = new Date(year, 0, 0);
  return Math.floor((date - start) / 86400000);
}

function calculate() {
  const E = parseFloat(document.getElementById("Intensyvity").value);
  const ψ = currentPsi;
  const a = currentA;

  const φ = parseFloat(document.getElementById('phi').value);
  const date = document.getElementById('date').value;
  const B = parseFloat(document.getElementById('B').value);

  const dayOfYear = calculateDayOfYear(date);
  const δ_deg = 23.45 * Math.sin((Math.PI/180) * (360/365 * (284 + dayOfYear)));
  const δ = δ_deg * Math.PI/180;

  const ω = 0;
  const γ = 180 + (Math.atan2(
      Math.sin(ω * Math.PI/180),
      Math.cos(ω * Math.PI/180) * Math.sin(φ * Math.PI/180) - 
      Math.tan(δ) * Math.cos(φ * Math.PI/180)
  ) * 180/Math.PI);

  const cosθ = Math.sin(δ) * Math.sin((φ - B) * Math.PI/180) +
              Math.cos(δ) * Math.cos((φ - B) * Math.PI/180) * Math.cos(ω * Math.PI/180);
  const θ = Math.acos(Math.min(Math.max(cosθ, 0), 1)) * 180/Math.PI;

  const Eпр = E * (1-ψ)*cosθ;
  const Eдиф = E * ψ * (1 + Math.cos(B * Math.PI/180)) / 2;
  const Eвід = E * a * (1 - Math.cos(B * Math.PI/180)) / 2;
  const Eсп = Eпр + Eдиф + Eвід;

  document.getElementById('theta').textContent = θ.toFixed(2);
  document.getElementById('Epr').textContent = Eпр.toFixed(2);
  document.getElementById('Edif').textContent = Eдиф.toFixed(2);
  document.getElementById('Evid').textContent = Eвід.toFixed(2);
  document.getElementById('Esp').textContent = Eсп.toFixed(2);

  updateCharts(E, ψ, a, φ, B, date);
}

function quadraticRegression(xData, yData) {
  const threshold = 0.1;
  const filteredData = xData.map((x, i) => ({ x, y: yData[i] }))
                            .filter(point => point.y > threshold);

  if (filteredData.length < 3) {
      console.warn("Недостаточно точек для аппроксимациi");
      return { a: 0, b: 0, c: 0 };
  }

  const n = filteredData.length;
  let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
  let sumY = 0, sumXY = 0, sumX2Y = 0;

  for (let i = 0; i < n; i++) {
      const { x, y } = filteredData[i];
      sumX  += x;
      sumX2 += x * x;
      sumX3 += x * x * x;
      sumX4 += x * x * x * x;
      sumY  += y;
      sumXY += x * y;
      sumX2Y += x * x * y;
  }

  const D = sumX4 * (sumX2 * n - sumX * sumX) 
          - sumX3 * (sumX3 * n - sumX * sumX2) 
          + sumX2 * (sumX3 * sumX - sumX2 * sumX2);

  if (D === 0) {
      console.warn('Дiлення на 0');
      return { a: 0, b: 0, c: 0 };
  }

  const Da = sumX2Y * (sumX2 * n - sumX * sumX)
           - sumX3 * (sumXY * n - sumX * sumY)
           + sumX2 * (sumXY * sumX - sumX2 * sumY);

  const Db = sumX4 * (sumXY * n - sumX * sumY)
           - sumX2Y * (sumX3 * n - sumX * sumX2)
           + sumX2 * (sumX3 * sumY - sumXY * sumX2);

  const Dc = sumX4 * (sumX2 * sumY - sumXY * sumX)
           - sumX3 * (sumX3 * sumY - sumXY * sumX2)
           + sumX2Y * (sumX3 * sumX - sumX2 * sumX2);

  return {
      a: Da / D,
      b: Db / D,
      c: Dc / D
  };
}

function updateCharts(E, ψ, a, φ, B, date) {
  if (timeChart) timeChart.destroy();
  if (angleChart) angleChart.destroy();

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const timeData = hours.map(h => calculateEsp(h, B, E, ψ, a, φ, date));
  const { a: coefA, b: coefB, c: coefC } = quadraticRegression(hours, timeData);

  document.getElementById('regressionEquation').textContent = 
    `y = ${coefA.toFixed(4)}x² + ${coefB.toFixed(4)}x + ${coefC.toFixed(4)}`;

  const fittedData = hours.map(h => coefA * h * h + coefB * h + coefC);

  timeChart = new Chart(document.getElementById('timeChart'), {
      type: 'line',
      data: {
          labels: hours,
          datasets: [
              {
                  label: 'Eсп (Вт/м²)',
                  data: timeData,
                  borderColor: '#e74c3c',
                  tension: 0.3
              },
              {
                  label: 'Квадратична апроксимація',
                  data: fittedData,
                  borderColor: '#27ae60',
                  borderDash: [5, 5],
                  tension: 0.3
              }
          ]
      },
      options: {
          scales: {
              x: { 
                title: { 
                  display: true,
                  text: 'Час доби, години'
                } 
              },
              y: { 
                title: {
                  display: true,
                  text: 'Інтенсивність на похилу поверхню сонячної панелі, (Вт/м²)'
                },
                max: E * 1.2,
                min: -100
              }
          }
      }
  });

  const angles = Array.from({ length: 71 }, (_, i) => i + 10);
  angleChart = new Chart(document.getElementById('angleChart'), {
      type: 'line',
      data: {
          labels: angles,
          datasets: [{
              label: 'Eсп (Вт/м²)',
              data: angles.map(angle => calculateEsp(12, angle, E, ψ, a, φ, date)),
              borderColor: '#3498db',
              tension: 0.3
          }]
      },
      options: {
          scales: {
            x: { 
                title: { 
                  display: true,
                  text: 'Кут нахилу сонячної панелi, градуси°'
                } 
            },
            y: { 
                title: {
                  display: true,
                  text: 'Інтенсивність на похилу поверхню сонячної панелі, (Вт/м²)'
                },
                max: E * 1.2
            }
          }
      }
  });
}

function calculateEsp(hour, B, E, ψ, a, φ, date) {
  const dayOfYear = calculateDayOfYear(date);
  const δ = 23.45 * Math.sin((Math.PI/180) * (360/365 * (284 + dayOfYear))) * Math.PI/180;
  const ω = (hour - 12) * 15 * Math.PI/180;
  const cosθ = Math.sin(δ) * Math.sin((φ - B) * Math.PI/180) +
               Math.cos(δ) * Math.cos((φ - B) * Math.PI/180) * Math.cos(ω);
  if (cosθ <= 0) return 0;
  return E * (1 - ψ)*cosθ + E * ψ * (1 + Math.cos(B * Math.PI/180))/2 + E * a * (1 - Math.cos(B * Math.PI/180))/2;
}

document.addEventListener('DOMContentLoaded', function() {
  initMap();
  document.getElementById('date').addEventListener('change', onDateChange);
  calculate();
});
