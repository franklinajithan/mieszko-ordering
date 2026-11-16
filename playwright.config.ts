import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:90000,
  expect:{timeout:15000},retries:0,
  reporter:[['list'],['json',{outputFile:'test-results/system-results.json'}]],
  use:{baseURL:'http://127.0.0.1:3100',headless:true,actionTimeout:15000,launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:undefined,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'node tests/support/test-database.mjs',port:55432,reuseExistingServer:false,timeout:60000},
    {command:'npm run start -- --hostname 127.0.0.1 --port 3100',url:'http://127.0.0.1:3100/setup',reuseExistingServer:false,timeout:90000,
      env:{DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable',DATABASE_POOL_SIZE:'1',PORT:'3100',APP_URL:'http://127.0.0.1:3100'}},
  ],
});
