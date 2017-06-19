const _ = require('lodash');
const AWS = require('aws-sdk');
const retry = require('bluebird-retry');
const region = 'us-west-2';
const stepfunctions = new AWS.StepFunctions({ region });

// update these values
const ACCOUNT = '12345678910'; // aws account number
const BUCKET = 'sample-create-react-app'; // s3 bucket for static site

if (ACCOUNT === '12345678910') {
  console.error('Missing ACCOUNT number in config');
  return;
}

if (BUCKET === 'sample-create-react-app') {
  console.error('Replace example bucket with your own unique bucket name');
  return;
}

// env vars passed to codebuild project
// CI_SCRIPT* vars are converted to buildspec based scripts
const codebuilderConfig = {
  CI_REPO: 'eddywashere/sample-create-react-app', // example project
  CI_SCRIPT_INSTALL: 'npm install -g yarn && yarn install --silent',
  CI_SCRIPT_PRE_BUILD: 'npm run test',
  CI_SCRIPT_BUILD: 'npm run build',
  CI_SCRIPT_POST_BUILD: `BUCKET=${BUCKET} npm run s3:upload`,
  CI_COMMIT: 'master'
  // add any other custom env vars your project needs
};

const createCodeBuildEnvOverride = config =>
  Object.keys(config).map(key => ({ name: key, value: config[key] }));

const getBuildLink = (executionArn) => {
  return () => {
    return stepfunctions.getExecutionHistory({
      executionArn, /* required */
      maxResults: 100
    }).promise()
      .then(({events}) => {
        console.log('attempting to grab buildId from step function history');
        const codebuildSuccessEvent = _.find(events, (e) => {
          return e.type === 'LambdaFunctionSucceeded';
        });

        if (!codebuildSuccessEvent) {
          return Promise.reject('LambdaFunctionSucceeded not found');
        }

        const buildOutput = _.get(codebuildSuccessEvent, 'lambdaFunctionSucceededEventDetails.output', '{}');
        const { buildId } = JSON.parse(buildOutput);

        if (!buildId) {
          return Promise.reject('buildId not found');
        }

        return `https://${region}.console.aws.amazon.com/codebuild/home?region=${region}#/builds/${buildId}/view/new`;
      });
  };
}

const build = (config, slackEvent) => {
  const params = {
    stateMachineArn: `arn:aws:states:us-west-2:${ACCOUNT}:stateMachine:codebuilder_state_machine`,
    input: JSON.stringify({
      slackEvent, // if slackEvent exists, it'll be used to send channel updates as the build executes
      config: createCodeBuildEnvOverride(config), // ex: [{name: 'string', value: 'string'}]
      step_name: 'start_build' // <- required for determining which lambda step to run
    })
  };
  console.log('running codebuilder step function execution')
  return stepfunctions
    .startExecution(params)
    .promise()
    .then(({executionArn}) => retry(getBuildLink(executionArn), { max_tries: 10, interval: 5000 }))
    .then((buildLink) => {
      return `CodeBuild Execution Started: Logs - ${buildLink}`;
    })
    .catch(error => {
      console.error('Error: startExecution', error);
      return `CodeBuilder error...\n\n${error}`;
    });
};

build(codebuilderConfig).then(console.log).catch(console.error);
