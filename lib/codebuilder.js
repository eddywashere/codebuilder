const AWS = require('aws-sdk');
const region = 'us-west-2';
const codebuild = new AWS.CodeBuild({region});
const projectName = 'codebuilder';

const start = (env) => {
  // TODO: add env validation
  const params = {
    projectName,
    environmentVariablesOverride: env || []
  };

  return codebuild.startBuild(params).promise()
    .then((data) => {
      const streamId = data.build.id.split(':')[1];
      const logs = 'https://us-west-2.console.aws.amazon.com' +
      '/cloudwatch/home?region=' + region + '#logEventViewer:group=/aws/codebuild/' +
      projectName + ';stream=' + streamId;

      console.log('[codebuilder] success', {id: data.build.id, logs});
      return Object.assign({}, data.build, { logs });
    })
    .catch(error => {
      console.error('[codebuilder] error', error);
      return Promise.reject(error);
    });
};

// returns codebuild build info
const get = (event) => {
  if (!event.buildId) {
    return null;
  }

  const params = {
    ids: [event.buildId]
  };

  return codebuild.batchGetBuilds(params).promise()
    .then(({builds}) => builds[0])
    .then(buildInfo => {
      console.log('Success: batchGetBuilds', { buildInfo });
      return buildInfo;
    })
    .catch(error => {
      console.error('Error: batchGetBuilds', { error });
      return Promise.reject(error);
    });
};


module.exports = {
  start,
  get
};
