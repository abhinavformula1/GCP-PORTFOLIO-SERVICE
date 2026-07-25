'use strict';

function dependencyError(path, message) {
  const error = new TypeError(`${path}: ${message}`);
  error.code = 'INVALID_COMPOSITION';
  return error;
}

function assertPort(value, path, methods) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    throw dependencyError(path, 'required port is missing');
  }
  for (const method of methods || []) {
    if (typeof value[method] !== 'function') {
      throw dependencyError(`${path}.${method}`, 'required method is missing');
    }
  }
  return value;
}

function assertDependencies(dependencies, path, specification) {
  if (!dependencies || typeof dependencies !== 'object') {
    throw dependencyError(path, 'dependencies object is required');
  }
  for (const [name, requirement] of Object.entries(specification || {})) {
    const value = dependencies[name];
    if (requirement === 'function') {
      if (typeof value !== 'function') {
        throw dependencyError(`${path}.${name}`, 'required function is missing');
      }
    } else if (requirement === 'value') {
      if (value == null) {
        throw dependencyError(`${path}.${name}`, 'required value is missing');
      }
    } else if (Array.isArray(requirement)) {
      assertPort(value, `${path}.${name}`, requirement);
    }
  }
  return dependencies;
}

module.exports = { assertPort, assertDependencies, dependencyError };
