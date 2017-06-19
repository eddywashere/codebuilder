const _ = require('lodash');
const AWS = require('aws-sdk');
const botBuilder = require('claudia-bot-builder');
const lambda = new AWS.Lambda();
const slackDelayedReply = botBuilder.slackDelayedReply;
const codebuilder = require('./codebuilder');

const successHandler = (event, context, msg) => {
  if (!event.slackEvent) {
    return Promise.resolve(context.succeed(event));
  }

  return slackDelayedReply(event.slackEvent, {
    text: msg,
    response_type: 'in_channel'
  })
    .then(() => context.succeed(event))
    .catch(error => {
      console.error(error);
      return Promise.reject(error);
    });
};

const errorHandler = (event, context, error) => {
  if (!event.slackEvent) {
    return Promise.resolve(context.fail(error));
  }

  return slackDelayedReply(event.slackEvent, {
    text: `CODEBUILDER encountered an error: ${error}`,
    response_type: 'in_channel'
  })
    .then(() => context.fail(error))
    .catch(error => {
      console.error(error);
      return Promise.reject(error);
    });
};

const start_build = (event, context) => {
  const { config } = event;
  // TODO: add config validation
  console.log('starting start_build', { event });
  return codebuilder
    .start(config)
    .then(({ id, logs }) => {
      return successHandler(
        Object.assign({}, event, {
          buildId: id,
          buildLogs: logs,
          step_name: 'wait_for_build'
        }),
        context,
        `Codebuild started, see additional logs: ${logs}`
      );
    })
    .catch(err => errorHandler(event, context, err));
};

const wait_for_build = (event, context) => {
  console.log('starting wait_for_build', event);

  return codebuilder
    .get(event)
    .then(({ buildStatus }) => {
      if (buildStatus === 'IN_PROGRESS') {
        return context.fail(new Error('Build status in progress'));
      }

      const newEventResponse = Object.assign({}, event, {
        buildStatus,
        step_name: 'end_build'
      });

      return context.succeed(newEventResponse);
    })
    .catch(context.fail);
};

const end_build = (event, context) => {
  console.log('starting end_build', event);

  if (event.buildStatus !== 'SUCCEEDED') {
    return errorHandler(
      event,
      context,
      new Error(`Codebuild Error: ${event.buildStatus}, ${event.buildLogs}`)
    );
  }

  return successHandler(
    event,
    context,
    `Codebuild finished: status - ${event.buildStatus || 'unknown'}, ${event.buildLogs}`
  );
};

const catch_build = (event, context) => {
  console.error('starting catch_build', event);

  return errorHandler(
    event,
    context,
    new Error(`UnexpectedError`)
  );
};

module.exports = {
  start_build,
  wait_for_build,
  end_build,
  catch_build
};
