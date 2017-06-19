const steps = require('./lib/steps');

exports.handler = (event, context) => {
  const {step_name} = event;
  if (!step_name) {
    return steps['start_build'](event, context);
  } else if (!steps[step_name]) {
    console.error('----- event debug -----', event, {step_name})
    return context.fail(`Error: Missing step function: ${step_name}`);
  }

  return steps[step_name](event, context);
};
