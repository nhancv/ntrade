import express from 'express';
import moment from 'moment';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import request from 'request';
import printLog from 'chalk-printer';
import logFile from 'nlogj';
import Mail from './Mail';

logFile.setLogName('ntrade.log').clearLog();
const app = express();
const log = console.log;
const port = process.env.PORT || 4000;

// Body parser: https://github.com/expressjs/body-parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
// CORS on ExpressJS: https://github.com/expressjs/cors
app.use(cors());
// Cookie parser: https://github.com/expressjs/cookie-parser
app.use(cookieParser());

// For fontend route
const frontendDir = path.join(path.dirname(path.dirname(__dirname)), 'frontend');
app.use('/home', express.static(path.join(frontendDir, 'build')));
app.get('/home', function(req, res) {
  res.sendFile(path.join(frontendDir, 'build', 'index.html'));
});
app.get('/', function(req, res) {
  res.redirect('/home');
});

app.listen(port, function() {
  printLog.ok('Server listening at port %d', port);
});

let WebSocketClient = require('websocket').client;
let client = new WebSocketClient();

client.on('connectFailed', function(error) {
  printLog.error('Connect Error: ' + error.toString());
});

client.on('connect', function(connection) {
  printLog.ok('WebSocket Client Connected');
  connection.on('error', function(error) {
    printLog.error('Connection Error: ' + error.toString());
  });
  connection.on('close', function() {
    printLog.warn('Connection Closed');
    //Need auto reconnect
  });
  connection.on('message', function(message) {
    if (message.type === 'utf8') {
      // log("Received: '" + message.utf8Data + "'")
      let body = JSON.parse(message.utf8Data);
      if (body.k.x === true) {
        checking();
      }
    }
  });
});

const { email, password } = require('./secret.json');
const mail = new Mail(email, password);

const symbol: string = 'tusdbtc';
const durTime: string = '1m';
const safeRange: number = 5;

client.connect(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${durTime}`);

/**
 * fetchKLineVolume
 [
 [
 1499040000000,      // Open time
 "0.01634790",       // Open
 "0.80000000",       // High
 "0.01575800",       // Low
 "0.01577100",       // Close
 "148976.11427815",  // Volume
 1499644799999,      // Close time
 "2434.19055334",    // Quote asset volume
 308,                // Number of trades
 "1756.87402397",    // Taker buy base asset volume
 "28.46694368",      // Taker buy quote asset volume
 "17928899.62484339" // Ignore.
 ]
 ]
 */
function fetchKLineVolume() {
  return new Promise((resolve, reject) => {
    request(
      `https://api.binance.com/api/v1/klines?symbol=${symbol.toUpperCase()}&interval=${durTime}&limit=${safeRange + 2}`,
      (error, response, body) => {
        if (error) {
          reject(error);
        } else {
          resolve(JSON.parse(body));
        }
      }
    );
  });
}

/**
 * Return round as floor
 * precisionFloorRound(0.9999999999, 8)
 * => 0.99999999
 * @param {*} number
 * @param {*} precision
 */
function precisionFloorRound(number, precision) {
  var factor = Math.pow(10, precision);
  return Math.floor(number * factor) / factor;
}

/*************
 * Logic check unnormal signal.
 * Check 10 candle (not include current)
 * X[9..0] Current is green candle
 * If current > 6 * X[0] && max(X[9..1]) < 4 * avg(X[9..1])
 */
function checking() {
  printLog.trace('Checking...');
  fetchKLineVolume().then(
    value => {
      if (Array.isArray(value) && value.length) {
        let volArr = value.map(v => parseFloat(v[5])) as Array<number>;
        let currentVol = volArr[volArr.length - 2];
        let currentTime = value[volArr.length - 2][0];
        let currentOpen = parseFloat(value[volArr.length - 2][1]);
        let currentClose = parseFloat(value[volArr.length - 2][4]);
        if (currentOpen <= currentClose) {
          let prevVol = volArr[volArr.length - 3];
          volArr.splice(-1, 3);
          let sum = volArr.reduce((a, b) => a + b);
          let avg = precisionFloorRound(sum / volArr.length, 2);
          let maxValue = Math.max(...volArr);
          let dataLog = `Vol: ${currentVol} - Avg: ${avg} - Max: ${maxValue}`;
          printLog.log(dataLog);
          if (maxValue < 4 * avg && currentVol > 6 * prevVol) {
            //trigger
            let timeStr = moment(currentTime).format();
            logFile.log((dataLog = dataLog + `\r\nOpen: ${currentOpen} - Close: ${currentClose} - Time: ${timeStr}`));
            printLog.ok('OK');
            mail.sendMail(symbol, timeStr, dataLog);
          } else {
            printLog.trace('Normal');
          }
        } else {
          printLog.trace('Red candle');
        }
      } else {
        printLog.log('Data must be Array type');
      }
    },
    error => {
      printLog.error(error.message);
    }
  );
}
