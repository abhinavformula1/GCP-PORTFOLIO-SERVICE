'use strict';

require('dotenv').config();

const { startServer } = require('./src/main/server');
const { installGracefulShutdown } = require('./src/main/lifecycle');
const { createRuntime } = require('./src/main/runtime');
const { loadConfig } = require('./src/infrastructure/config');

const config = loadConfig(process.env);
const control = startServer({ config, runtime: createRuntime(config) });
installGracefulShutdown(control);
