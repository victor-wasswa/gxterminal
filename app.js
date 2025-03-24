// Server-side code
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const technicalindicators = require('technicalindicators');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const port = 3000; // Changed to 3000 since we'll serve everything from one port

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const TRADERMADE_API_KEY = process.env.TRADERMADE_API_KEY;
if (!TRADERMADE_API_KEY) {
    throw new Error("TRADERMADE_API_KEY not found in environment variables");
}

const BASE_URL = 'https://marketdata.tradermade.com/api/v1';

async function getHistoricalData() {
    try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);

        const url = `${BASE_URL}/timeseries`;
        const params = {
            currency: 'EURUSD',
            api_key: TRADERMADE_API_KEY,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0]
        };

        const response = await axios.get(url, { params });
        if (response.data && response.data.quotes) {
            return response.data.quotes;
        }
        return null;
    } catch (error) {
        console.error('Error fetching historical data:', error);
        return null;
    }
}

function calculateTechnicalIndicators(data) {
    const closes = Object.values(data).map(quote => quote.close);
    
    // Calculate RSI
    const rsi = new technicalindicators.RSI({
        values: closes,
        period: 14
    }).getResult();

    // Calculate MACD
    const macd = new technicalindicators.MACD({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
    }).getResult();

    // Calculate Bollinger Bands
    const bb = new technicalindicators.BollingerBands({
        values: closes,
        period: 20,
        stdDev: 2
    }).getResult();

    return {
        closes,
        rsi: rsi[rsi.length - 1],
        macd: macd[macd.length - 1],
        bb: bb[bb.length - 1]
    };
}

function analyzeMarket(data, indicators) {
    const currentPrice = indicators.closes[indicators.closes.length - 1];
    const previousPrice = indicators.closes[indicators.closes.length - 2];
    const rsi = indicators.rsi;
    const macd = indicators.macd;
    const bb = indicators.bb;

    // Calculate price momentum
    const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;

    // Generate trading signals
    let signal = null;
    let confidence = 0;
    const timeInterval = "5-15 minutes";

    // RSI conditions
    if (rsi < 30) {
        signal = "BUY";
        confidence = 0.85;
    } else if (rsi > 70) {
        signal = "SELL";
        confidence = 0.85;
    }

    // MACD conditions
    if (macd.MACD > macd.signal && macd.histogram > 0) {
        if (signal === "BUY") {
            confidence += 0.1;
        } else if (!signal) {
            signal = "BUY";
            confidence = 0.8;
        }
    } else if (macd.MACD < macd.signal && macd.histogram < 0) {
        if (signal === "SELL") {
            confidence += 0.1;
        } else if (!signal) {
            signal = "SELL";
            confidence = 0.8;
        }
    }

    // Bollinger Bands conditions
    if (currentPrice < bb.lower) {
        if (signal === "BUY") {
            confidence += 0.05;
        }
    } else if (currentPrice > bb.upper) {
        if (signal === "SELL") {
            confidence += 0.05;
        }
    }

    return {
        signal,
        confidence: Math.min(confidence, 1.0),
        timeInterval,
        currentPrice,
        rsi,
        macd: macd.MACD,
        priceChange
    };
}

// API Routes
app.get('/api/analysis', async (req, res) => {
    try {
        const historicalData = await getHistoricalData();
        if (!historicalData) {
            return res.status(500).json({ error: 'Failed to fetch market data' });
        }

        const indicators = calculateTechnicalIndicators(historicalData);
        const analysis = analyzeMarket(historicalData, indicators);

        res.json(analysis);
    } catch (error) {
        console.error('Error in analysis:', error);
        res.status(500).json({ error: 'Failed to analyze market data' });
    }
});

app.get('/api/historical-data', async (req, res) => {
    try {
        const historicalData = await getHistoricalData();
        if (!historicalData) {
            return res.status(500).json({ error: 'Failed to fetch market data' });
        }

        const dates = Object.keys(historicalData);
        const prices = Object.values(historicalData).map(quote => quote.close);

        res.json({
            dates,
            prices
        });
    } catch (error) {
        console.error('Error fetching historical data:', error);
        res.status(500).json({ error: 'Failed to fetch market data' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Client-side code (will be loaded by index.html)
if (typeof window !== 'undefined') {
    let priceChart = null;
    const API_BASE_URL = 'http://localhost:3000'; // Updated port to match server

    // Initialize the application
    document.addEventListener('DOMContentLoaded', () => {
        initializeChart();
        updateData();
        // Update data every 5 minutes
        setInterval(updateData, 300000);
    });

    function initializeChart() {
        const ctx = document.getElementById('priceChart').getContext('2d');
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'EUR/USD Price',
                    data: [],
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1,
                    borderWidth: 2,
                    pointRadius: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            precision: 5
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                }
            }
        });
    }

    async function fetchWithRetry(url, options, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    mode: 'cors',
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                return await response.json();
            } catch (error) {
                if (i === retries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }

    async function updateData() {
        try {
            showLoading();
            
            // Fetch historical data
            const historicalData = await fetchWithRetry(`${API_BASE_URL}/api/historical-data`);
            
            if (historicalData.error) {
                throw new Error(historicalData.error);
            }
            
            // Update chart
            priceChart.data.labels = historicalData.dates;
            priceChart.data.datasets[0].data = historicalData.prices;
            priceChart.update();
            
            // Fetch analysis
            const analysis = await fetchWithRetry(`${API_BASE_URL}/api/analysis`);
            
            if (analysis.error) {
                throw new Error(analysis.error);
            }
            
            // Update analysis results
            updateAnalysisResults(analysis);
            
        } catch (error) {
            console.error('Error fetching data:', error);
            showError(`Failed to fetch market data: ${error.message}`);
        }
    }

    function showLoading() {
        document.getElementById('analysisResults').innerHTML = `
            <div class="alert alert-info">
                Loading market data...
            </div>
        `;
        document.getElementById('tradingSignals').innerHTML = `
            <div class="alert alert-info">
                Analyzing market conditions...
            </div>
        `;
    }

    function updateAnalysisResults(analysis) {
        // Update technical indicators
        document.getElementById('rsiValue').textContent = analysis.rsi.toFixed(2);
        document.getElementById('macdValue').textContent = analysis.macd.toFixed(4);
        
        // Update market sentiment
        const sentimentValue = document.getElementById('sentimentValue');
        const progressBar = document.querySelector('.progress-bar');
        
        if (analysis.signal) {
            const sentiment = analysis.signal === 'BUY' ? 'Bullish' : 'Bearish';
            sentimentValue.textContent = sentiment;
            progressBar.style.width = `${analysis.confidence * 100}%`;
            progressBar.style.backgroundColor = analysis.signal === 'BUY' ? '#28a745' : '#dc3545';
        } else {
            sentimentValue.textContent = 'Neutral';
            progressBar.style.width = '50%';
            progressBar.style.backgroundColor = '#6c757d';
        }
        
        // Update trading signals
        const tradingSignals = document.getElementById('tradingSignals');
        if (analysis.signal) {
            const signalClass = analysis.signal === 'BUY' ? 'success' : 'danger';
            tradingSignals.innerHTML = `
                <div class="alert alert-${signalClass}">
                    <h5>${analysis.signal} Signal</h5>
                    <p>Confidence: ${(analysis.confidence * 100).toFixed(1)}%</p>
                    <p>Recommended Time Interval: ${analysis.timeInterval}</p>
                    <p>Current Price: ${analysis.currentPrice.toFixed(5)}</p>
                    <p>Price Change: ${analysis.priceChange.toFixed(2)}%</p>
                </div>
            `;
        } else {
            tradingSignals.innerHTML = `
                <div class="alert alert-warning">
                    No clear trading signal at the moment. Please wait for better conditions.
                </div>
            `;
        }
    }

    function showError(message) {
        const analysisResults = document.getElementById('analysisResults');
        analysisResults.innerHTML = `
            <div class="alert alert-danger">
                ${message}
            </div>
        `;
    }
} 