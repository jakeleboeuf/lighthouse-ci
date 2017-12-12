/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const fetch = require('node-fetch'); // polyfill
const minimist = require('minimist');

const CI_HOST = process.env.CI_HOST || 'https://lighthouse-ci.appspot.com';
const API_KEY = process.env.LIGHTHOUSE_API_KEY || process.env.API_KEY;
const RUNNERS = {chrome: 'chrome', wpt: 'wpt'};

if (process.env.API_KEY) {
  console.log(
    'Warning: The environment variable API_KEY is deprecated. Please use LIGHTHOUSE_API_KEY instead.'
  );
}

function printUsageAndExit() {
  const usage = `Usage:
runLighthouse.js [--score=<score>] [--no-comment] [--pr=<boolean>] [--runner=${Object.keys(
    RUNNERS
  )}] <url>

Options:
  --score      Minimum score for the pull request to be considered "passing".
               If omitted, merging the PR will be allowed no matter what the score. [Number]

  --no-comment Doesn't post a comment to the PR issue summarizing the Lighthouse results. [Boolean]

  --pr         By default Lighthouse will only run on PR's. To enable Lighthouse on all event
               types set to false to run Lighthouse on all activity [Boolean]

  --runner     Selects Lighthouse running on Chrome or WebPageTest. [--runner=${Object.keys(
    RUNNERS
  )}]

  --help       Prints help.

Examples:

  Runs Lighthouse and posts a summary of the results.
    runLighthouse.js https://example.com

  Runs Lighthouse and posts a summary of the results on every test run.
    runLighthouse.js --pr=false https://example.com

  Fails the PR if the score drops below 93. Posts the summary comment.
    runLighthouse.js --score=93 https://example.com

  Runs Lighthouse on WebPageTest. Fails the PR if the score drops below 93.
    runLighthouse.js --score=93 --runner=wpt --no-comment https://example.com`;

  console.log(usage);
  process.exit(1);
}

/**
 * Setup pr info dependent upon CI provider.
 * @return {!Object} PR object.
 */
function getPrInfo() {
  const pr = {
    number: null,
    sha: null
  };

  // Setup for Travis
  if (process.env.TRAVIS) {
    pr.number = parseInt(process.env.TRAVIS_PULL_REQUEST, 10);
    pr.sha = process.env.TRAVIS_PULL_REQUEST_SHA;
  }

  // Setup for Circle CI
  if (process.env.CIRCLECI) {
    pr.number = parseInt(process.env.CIRCLE_PR_NUMBER, 10);
    pr.sha = process.env.CIRCLE_SHA1;
  }

  return pr;
}

/**
 * Collects command lines flags and creates settings to run LH CI.
 * @return {!Object} Settings object.
 */
function getConfig() {
  const args = process.argv.slice(2);
  const argv = minimist(args, {
    boolean: ['comment', 'help', 'pr'],
    default: {comment: true, pr: true},
    alias: {help: 'h'}
  });
  const config = {};

  if (argv.help) {
    printUsageAndExit();
  }

  config.testUrl = argv._[0];
  if (!config.testUrl) {
    console.log('Please provide a url to test.');
    printUsageAndExit();
  }

  // If pr is false, or if pr is true (default) and event type is a pull request
  config.runLighthouse =
    !argv.pr ||
    (argv.pr &&
      (process.env.TRAVIS_EVENT_TYPE === 'pull_request' || process.env.CIRCLE_PULL_REQUEST));

  config.addComment = argv.comment;
  config.minPassScore = Number(argv.score);
  if (!config.addComment && !config.minPassScore) {
    console.log('Please provide a --score when using --no-comment.');
    printUsageAndExit();
  }

  config.runner = argv.runner || RUNNERS.chrome;
  const possibleRunners = Object.keys(RUNNERS);
  if (!possibleRunners.includes(config.runner)) {
    console.log(`Unknown runner "${config.runner}". Options: ${possibleRunners}`);
    printUsageAndExit();
  }
  console.log(`Using runner: ${config.runner}`);

  config.pr = getPrInfo();

  const repoSlug =
    process.env.TRAVIS_PULL_REQUEST_SLUG ||
    process.env.CIRCLE_PULL_REQUEST ||
    process.env.CIRCLE_REPOSITORY_URL;

  config.repo = {
    owner: repoSlug ? repoSlug.split('/')[0] : null,
    name: repoSlug ? repoSlug.split('/')[1] : null
  };

  console.log('ENV:', process.env.CIRCLE_PROJECT_USERNAME, process.env.CIRCLE_PROJECT_REPONAME);
  console.log('Slug:', config.repo.owner, config.repo.name);

  return config;
}

/**
 * @param {!Object} config Settings to run the Lighthouse CI.
 */
function run(config) {
  let endpoint;
  let body = JSON.stringify(config);

  switch (config.runner) {
    case RUNNERS.wpt:
      endpoint = `${CI_HOST}/run_on_wpt`;
      break;
    case RUNNERS.chrome: // same as default
    default:
      endpoint = `${CI_HOST}/run_on_chrome`;
      body = JSON.stringify(Object.assign({format: 'json'}, config));
  }

  fetch(endpoint, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY
    }
  })
    .then(resp => resp.json())
    .then(json => {
      if (config.runner === RUNNERS.wpt) {
        console.log(`Started Lighthouse run on WebPageTest: ${json.data.target_url}`);
        return;
      }
      console.log('Lighthouse CI score:', json.score);
    })
    .catch(err => {
      console.log('Lighthouse CI failed', err);
      process.exit(1);
    });
}

// Run LH if this is a PR, or --pr is false.
const config = getConfig();

if (config.runLighthouse) {
  run(config);
} else {
  console.log(
    'Lighthouse is not run for non-PR commits by default. Run with --pr=false to enable for all builds.'
  );
}
