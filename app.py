from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import numpy as np
import requests
from datetime import datetime, timedelta
import talib
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
# Configure CORS to allow all origins and methods
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "Access-Control-Allow-Credentials"],
        "supports_credentials": True
    }
})

# Add CORS headers to all responses
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

TRADERMADE_API_KEY = os.getenv('TRADERMADE_API_KEY')
if not TRADERMADE_API_KEY:
    raise ValueError("TRADERMADE_API_KEY not found in environment variables")

BASE_URL = 'https://marketdata.tradermade.com/api/v1'

def get_historical_data():
    """Fetch historical EUR/USD data from Tradermade API"""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    url = f"{BASE_URL}/timeseries"
    params = {
        'currency': 'EURUSD',
        'api_key': TRADERMADE_API_KEY,
        'start_date': start_date.strftime('%Y-%m-%d'),
        'end_date': end_date.strftime('%Y-%m-%d')
    }
    
    response = requests.get(url, params=params)
    data = response.json()
    
    if 'quotes' in data:
        df = pd.DataFrame.from_dict(data['quotes'], orient='index')
        df.index = pd.to_datetime(df.index)
        return df
    return None

def calculate_technical_indicators(df):
    """Calculate technical indicators for analysis"""
    # RSI
    df['RSI'] = talib.RSI(df['close'].values)
    
    # MACD
    macd, macd_signal, macd_hist = talib.MACD(df['close'].values)
    df['MACD'] = macd
    df['MACD_Signal'] = macd_signal
    df['MACD_Hist'] = macd_hist
    
    # Bollinger Bands
    upper, middle, lower = talib.BBANDS(df['close'].values)
    df['BB_Upper'] = upper
    df['BB_Middle'] = middle
    df['BB_Lower'] = lower
    
    return df

def analyze_market(df):
    """Perform market analysis and generate trading signals"""
    current_price = df['close'].iloc[-1]
    rsi = df['RSI'].iloc[-1]
    macd = df['MACD'].iloc[-1]
    macd_signal = df['MACD_Signal'].iloc[-1]
    
    # Calculate price momentum
    price_change = (current_price - df['close'].iloc[-2]) / df['close'].iloc[-2] * 100
    
    # Generate trading signals
    signal = None
    confidence = 0
    time_interval = "5-15 minutes"
    
    # RSI conditions
    if rsi < 30:
        signal = "BUY"
        confidence = 0.85
    elif rsi > 70:
        signal = "SELL"
        confidence = 0.85
    
    # MACD conditions
    if macd > macd_signal and macd_hist > 0:
        if signal == "BUY":
            confidence += 0.1
        elif signal is None:
            signal = "BUY"
            confidence = 0.8
    elif macd < macd_signal and macd_hist < 0:
        if signal == "SELL":
            confidence += 0.1
        elif signal is None:
            signal = "SELL"
            confidence = 0.8
    
    # Bollinger Bands conditions
    if current_price < df['BB_Lower'].iloc[-1]:
        if signal == "BUY":
            confidence += 0.05
    elif current_price > df['BB_Upper'].iloc[-1]:
        if signal == "SELL":
            confidence += 0.05
    
    return {
        'signal': signal,
        'confidence': min(confidence, 1.0),
        'time_interval': time_interval,
        'current_price': current_price,
        'rsi': rsi,
        'macd': macd,
        'price_change': price_change
    }

@app.route('/api/analysis', methods=['GET'])
def get_analysis():
    df = get_historical_data()
    if df is None:
        return jsonify({'error': 'Failed to fetch market data'}), 500
    
    df = calculate_technical_indicators(df)
    analysis = analyze_market(df)
    
    return jsonify(analysis)

@app.route('/api/historical-data', methods=['GET'])
def get_historical():
    df = get_historical_data()
    if df is None:
        return jsonify({'error': 'Failed to fetch market data'}), 500
    
    return jsonify({
        'dates': df.index.strftime('%Y-%m-%d %H:%M:%S').tolist(),
        'prices': df['close'].tolist()
    })

if __name__ == '__main__':
    app.run(debug=True) 