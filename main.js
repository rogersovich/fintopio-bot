const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const readline = require("readline");
const { DateTime } = require("luxon");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { proxyList } = require("./config/proxy.js");
const logger = require('./utils/logger.js');


class Fintopio {
  constructor() {
    this.baseUrl = "https://fintopio-tg.fintopio.com/api";
    this.headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://fintopio-tg.fintopio.com/",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?1",
      "Sec-Ch-Ua-Platform": '"Android"',
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36",
    };
    this.proxy = null
    this.axios_api = axios.create();

    // Interceptor untuk logging request
    this.axios_api.interceptors.request.use(
      async (config) => {
        let ip;
        const method = config.method.toUpperCase();
        const url = config.url;
    
        // Mengecek apakah proxy digunakan di dalam config
        if (this.proxy) {
          // Gunakan proxy
          const httpsAgent = new HttpsProxyAgent(this.proxy);
          config.httpsAgent = httpsAgent;
          try {
            ip = await this.checkIP(); // Memanggil fungsi untuk mendapatkan original dan proxy IP
            logger.info(
              `${method} : ${url} (Requester : Original IP : ${ip[0]} : Proxy IP ${ip[1]})`
            );
          } catch (error) {
            logger.error(`Failed to fetch IPs: ${error.message}`);
          }
        } else {
          logger.info(`${method} : ${url} (No proxy used)`);
        }
    
        if (config.data) {
          logger.debug(`Request data: ${JSON.stringify(config.data)}`);
        }
    
        return config;
      },
      (error) => {
        logger.error(`Request error: ${error.message}`);
        return Promise.reject(error);
      }
    );

    // Interceptor untuk logging response
    this.axios_api.interceptors.response.use(
      (response) => {
        logger.debug(`Response status: ${response.status}, data: ${JSON.stringify(response.data)}`);
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(`Response error from ${error.response.config.url}: ${error.message}`);
          logger.debug(`Response status: ${error.response.status}, data: ${JSON.stringify(error.response.data)}`);
        } else {
          logger.error(`Request failed: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  log(msg, color = "white", type = "INFO") {
    const logMessgae = `[ ${type['cyan']} ] : ${msg[color]}`;
    console.log(logMessgae);
  }

  async waitWithCountdown(seconds, msg = "continue") {
    const spinners = ["|", "/", "-", "\\"];
    let i = 0;
    let hours = Math.floor(seconds / 3600);
    let minutes = Math.floor((seconds % 3600) / 60);
    let remainingSeconds = seconds % 60;
    for (let s = seconds; s >= 0; s--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(
        `${spinners[i]} Waiting ${hours}h ${minutes}m ${remainingSeconds}s to ${msg} ${spinners[i]}`
          .cyan
      );
      i = (i + 1) % spinners.length;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      remainingSeconds--;
      if (remainingSeconds < 0) {
        remainingSeconds = 59;
        minutes--;
        if (minutes < 0) {
          minutes = 59;
          hours--;
        }
      }
    }
    console.log("");
  }

  async checkIP() {
    const options = {};
    
    if (this.proxy) {
      let originalIp;
      let proxyIp;
      try {
        // Fetch IP tanpa proxy
        const res = await axios.get("https://api.ipify.org?format=json");
        originalIp = res.data.ip;
      } catch (error) {
        throw Error(`Failed to fetch original IP: ${error.message}`);
      }
  
      // Gunakan proxy
      const httpsAgent = new HttpsProxyAgent(this.proxy);
      
      try {
        const res = await axios.get("https://api.ipify.org?format=json", { httpsAgent });
        proxyIp = res.data.ip;
      } catch (error) {
        throw Error(`Failed to fetch proxy IP: ${error.message}`);
      }
  
      return [originalIp, proxyIp];
    }
  }


  async auth(userData) {
    const url = `${this.baseUrl}/auth/telegram`;
    const headers = { ...this.headers, Webapp: "true" };

    try {
      const response = await this.axios_api.get(`${url}?${userData}`, { 
        headers,
      });
      return response.data.token;
    } catch (error) {
      this.log(`Authentication error: ${error.message}`, "red");
      return null;
    }
  }

  async getProfile(token) {
    const url = `${this.baseUrl}/referrals/data`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      Webapp: "false, true",
    };

    try {
      const response = await this.axios_api.get(url, { headers });
      return response.data;
    } catch (error) {
      this.log(`Error fetching profile: ${error.message}`, "red");
      return null;
    }
  }

  async checkInDaily(token) {
    const url = `${this.baseUrl}/daily-checkins`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      await this.axios_api.post(url, {}, { headers });
      this.log("Daily check-in successful!", "green");
    } catch (error) {
      this.log(`Daily check-in error: ${error.message}`, "red");
    }
  }

  async getFarmingState(token) {
    const url = `${this.baseUrl}/farming/state`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
    };

    const fetchFarmingState = async (retryCount = 0) => {
      try {
        const response = await this.axios_api.get(url, { headers });
        return response.data;
      } catch (error) {
        if (error.message.includes("500") && retryCount < 3) {
          this.log(`500 error encountered, retrying... (${retryCount + 1}/3)`, "yellow");
          return await fetchFarmingState(retryCount + 1);
        }
        this.log(`Error fetching farming state: ${error.message}`, "red");
        return null;
      }
    };

    return await fetchFarmingState();
  }

  async startFarming(token) {
    const url = `${this.baseUrl}/farming/farm`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const startFarmingRequest = async (retryCount = 0) => {
      try {
        const response = await this.axios_api.post(url, {}, { headers });
        const finishTimestamp = response.data.timings.finish;

        if (finishTimestamp) {
          const finishTime = DateTime.fromMillis(finishTimestamp).toLocaleString(
            DateTime.DATETIME_FULL
          );
          this.log(`Starting farm...`, "yellow");
          this.log(`Farming completion time: ${finishTime}`, "green");
        } else {
          this.log("No completion time available.", "yellow");
        }
      } catch (error) {
        if (error.message.includes("500") && retryCount < 3) {
          this.log(`500 error encountered, retrying... (${retryCount + 1}/3)`, "yellow");
          return await startFarmingRequest(retryCount + 1);
        }
        this.log(`Error starting farming: ${error.message}`, "red");
      }
    };

    await startFarmingRequest();
  }

  async claimFarming(token, retryCount = 0) {
    const url = `${this.baseUrl}/farming/claim`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      await this.axios_api.post(url, {}, { headers });
      this.log("Farm claimed successfully!", "green");
    } catch (error) {
      if (error.message.includes("500") && retryCount < 3) {
        this.log(`500 error encountered, retrying... (${retryCount + 1}/3)`, "yellow");
        return await this.claimFarming(token, retryCount + 1);
      }
      this.log(`Error claiming farm: ${error.message}`, "red");
    }
  }

  async getDiamondInfo(token) {
    const url = `${this.baseUrl}/clicker/diamond/state`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      const response = await this.axios_api.get(url, { headers });
      if (response.data && response.data.state) {
        return response.data;
      } else {
        this.log("Error fetching diamond state: Invalid response data", "red");
        return null;
      }
    } catch (error) {
      this.log(`Error fetching diamond state: ${error.message}`, "red");
      return null;
    }
  }

  async claimDiamond(token, diamondNumber, totalReward, retryCount = 0) {
    const url = `${this.baseUrl}/clicker/diamond/complete`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const payload = { diamondNumber: diamondNumber };

    try {
      await this.axios_api.post(url, payload, { headers });
      this.log(`Success claim ${totalReward} diamonds!`, "green");
    } catch (error) {
      if (error.message.includes("500") && retryCount < 3) {
        this.log(`500 error encountered, retrying... (${retryCount + 1}/3)`, "yellow");
        return await this.claimDiamond(token, diamondNumber, totalReward, retryCount + 1);
      }
      this.log(`Error claiming Diamond: ${error.message}`, "red");
    }
  }

  async getTask(token) {
    const url = `${this.baseUrl}/hold/tasks`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    try {
      const response = await this.axios_api.get(url, { headers });
      return response.data;
    } catch (error) {
      this.log(`Error fetching task state: ${error.message}`, "red");
      return null;
    }
  }

  async startTask(token, taskId, slug) {
    const url = `${this.baseUrl}/hold/tasks/${taskId}/start`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      origin: "https://fintopio-tg.fintopio.com",
    };
    try {
      await this.axios_api.post(url, {}, { headers });
      this.log(`Starting task ${slug}!`, "green");
    } catch (error) {
      this.log(`Error starting task: ${error.message}`, "red");
    }
  }

  async claimTask(token, taskId, slug, rewardAmount) {
    const url = `${this.baseUrl}/hold/tasks/${taskId}/claim`;
    const headers = {
      ...this.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      origin: "https://fintopio-tg.fintopio.com",
    };
    try {
      await this.axios_api.post(url, {}, { headers });
      this.log(
        `Task ${slug} complete, reward ${rewardAmount} diamonds!`,
        "green"
      );
    } catch (error) {
      this.log(`Error claiming task: ${error.message}`, "red");
    }
  }

  extractFirstName(userData) {
    try {
      const userPart = userData.match(/user=([^&]*)/)[1];
      const decodedUserPart = decodeURIComponent(userPart);
      const userObj = JSON.parse(decodedUserPart);
      return userObj.first_name || "Unknown";
    } catch (error) {
      this.log(`Error extracting first_name: ${error.message}`, "red");
      return "Unknown";
    }
  }

  calculateWaitTime(firstAccountFinishTime) {
    if (!firstAccountFinishTime) return null;

    const now = DateTime.now();
    const finishTime = DateTime.fromMillis(firstAccountFinishTime);
    const duration = finishTime.diff(now);

    return duration.as("milliseconds");
  }

  async getAccountsArray(filePath, callback) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const accounts = JSON.parse(data);
        return Object.values(accounts);
    } catch (err) {
        console.error('Error:', err);
        throw err;
    }
  }
  async main() {
    while (true) {

      let accountsArray = []
      try {
          accountsArray = await this.getAccountsArray('accounts.json');
      } catch (err) {
          console.error('Failed to get accounts array:', err);
          process.exit(1);
      }

      let firstAccountFinishTime = null;

      if (proxyList.length > 0) {
        if (accountsArray.length != proxyList.length) {
          reject(
            `You have ${accountsArray.length} Session but you provide ${proxyList.length} Proxy`
          );
        }
      }

      for (let i = 0; i < accountsArray.length; i++) {
        const userData = accountsArray[i];

        const proxy = proxyList.length > 0 ? proxyList[i] : undefined;
        this.proxy = proxy;

        const first_name = this.extractFirstName(userData);
        console.log(`[ Account ${i + 1} | ${first_name} ]`.yellow);

        const token = await this.auth(userData);
        
        if (token) {
          this.log(`Login successful!`, "green");
          const profile = await this.getProfile(token);
          if (profile) {
            const balance = profile.balance;
            this.log(`Balance: ${balance}`, "green");

            await this.checkInDaily(token);

            try {
              const diamond = await this.getDiamondInfo(token);
              this.log(`Statu Diamond : ${diamond.state}`, "green");
              if (diamond && diamond.state === "available") {
                await this.waitWithCountdown(
                  Math.floor(Math.random() * (21 - 10)) + 10,
                  "claim Diamonds"
                );
                await this.claimDiamond(
                  token,
                  diamond.diamondNumber,
                  diamond.settings.totalReward
                );
              } else if (diamond && diamond.timings && diamond.timings.nextAt) {
                const nextDiamondTimeStamp = diamond.timings.nextAt;
                const nextDiamondTime = DateTime.fromMillis(
                  nextDiamondTimeStamp
                ).toLocaleString(DateTime.DATETIME_FULL);
                this.log(`Next Diamond time: ${nextDiamondTime}`, "green");

                if (i === 0) {
                  firstAccountFinishTime = nextDiamondTimeStamp;
                }
              } else {
                this.log("Unable to process diamond info", "yellow");
              }
            } catch (error) {
              this.log(
                `Error processing diamond info: ${error.message}`,
                "red"
              );
            }

            const farmingState = await this.getFarmingState(token);

            if (farmingState) {
              if (farmingState.state === "idling") {
                await this.startFarming(token);
              } else if (
                farmingState.state === "farmed" ||
                farmingState.state === "farming"
              ) {
                const finishTimestamp = farmingState.timings.finish;
                if (finishTimestamp) {
                  const finishTime = DateTime.fromMillis(
                    finishTimestamp
                  ).toLocaleString(DateTime.DATETIME_FULL);
                  this.log(`Farming completion time: ${finishTime}`, "green");

                  //   if (i === 0) {
                  //     firstAccountFinishTime = finishTimestamp;
                  //   }

                  const currentTime = DateTime.now().toMillis();
                  if (currentTime > finishTimestamp) {
                    await this.claimFarming(token);
                    await this.startFarming(token);
                  }
                }
              }
            }

            const taskState = await this.getTask(token);

            if (taskState) {
              for (const item of taskState.tasks) {
                if (item.status === "available") {
                  await this.startTask(token, item.id, item.slug);
                } else if (item.status === "verified") {
                  await this.claimTask(
                    token,
                    item.id,
                    item.slug,
                    item.rewardAmount
                  );
                } else if (item.status === "in-progress") {
                  continue;
                } else {
                  this.log(`Veryfing task ${item.slug}!`, "green");
                }
              }
            }
          }
        }
      }

      const waitTime = this.calculateWaitTime(firstAccountFinishTime);
      if (waitTime && waitTime > 0) {
        await this.waitWithCountdown(Math.floor(waitTime / 1000));
      } else {
        this.log("No valid wait time, continuing loop immediately.", "yellow");
        await this.waitWithCountdown(5);
      }
    }
  }
}

if (require.main === module) {
  logger.info("");
  logger.clear();
  logger.info("Application Started");
  const fintopio = new Fintopio();
  fintopio.main().catch((err) => {
    logger.info(`Application Error : ${err}`);
    console.error(err);
    process.exit(1);
  });
}
