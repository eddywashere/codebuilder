provider "aws" {
  region = "us-west-2"
}

terraform {
  backend "s3" {
    bucket = "codebuilder-tf" # replace with your remote state bucket name
    key = "codebuilder.tfstate"
    region = "us-west-2"
  }
}

# vars

# replace with your bucket name
resource "aws_s3_bucket" "codebuilder" {
  bucket = "codebuilder-tools"
  acl    = "private"

  versioning {
    enabled = true
  }
}

# CODEBUILD RESOURCES
resource "aws_iam_role" "codebuilder_role" {
  name = "codebuilder"

  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "codebuild.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
}

resource "aws_iam_policy" "codebuilder_policy" {
  name = "codebuild-policy-codebuilder"
  path = "/service-role/"
  description = "Policy used in trust relationship with CodeBuild"

  policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Resource": [
        "*"
      ],
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:us-west-2::alias/aws/ssm"
    },
    {
      "Effect": "Allow",
      "Resource": [
        "*"
      ],
      "Action": [
        "ssm:*",
        "s3:*",
        "route53:*",
        "lambda:*",
        "kms:*",
        "iam:*",
        "codebuild:*",
        "cloudfront:*",
        "apigateway:*",
        "acm:*"
      ]
    }
  ]
}
POLICY
}

resource "aws_iam_policy_attachment" "codebuilder_policy_attachment" {
  name = "codebuild-policy-attachment-codebuilder"
  policy_arn = "${aws_iam_policy.codebuilder_policy.arn}"
  roles = ["${aws_iam_role.codebuilder_role.id}"]
}

resource "aws_codebuild_project" "codebuilder" {
  name = "codebuilder"
  description  = "codebuild wrapper"
  build_timeout = "30"
  service_role = "${aws_iam_role.codebuilder_role.arn}"

  artifacts {
    type = "NO_ARTIFACTS"
  }

  source {
    type = "S3"
    location = "arn:aws:s3:::${aws_s3_bucket.codebuilder.id}/tools.zip"
  }

  environment {
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/nodejs:6.3.1"
    type         = "LINUX_CONTAINER"
    # environment_variable {
    #   "name" = "CI_REPO"
    #   "value" = "your/repo"
    # }
    environment_variable {
      "name"  = "CI"
      "value" = "true"
    }
    environment_variable {
      "name"  = "CI_COMMIT"
      "value" = "master"
    }
    environment_variable {
      "name"  = "CI_SCRIPT_INSTALL"
      "value" = "echo 'skipping...'"
    }
    environment_variable {
      "name"  = "CI_SCRIPT_PRE_BUILD"
      "value" = "echo 'skipping...'"
    }
    environment_variable {
      "name"  = "CI_SCRIPT_BUILD"
      "value" = "echo 'skipping...'"
    }
    environment_variable {
      "name"  = "CI_SCRIPT_POST_BUILD"
      "value" = "echo 'skipping...'"
    }
  }

  tags {
    "Service" = "codebuilder"
  }
}

# Step Function Lambda
resource "aws_iam_role" "codebuilder_lambda_role" {
  name = "codebuilder_lambda_role"
  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "swf.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "states.us-west-2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
}

resource "aws_iam_policy" "codebuilder_lambda_policy" {
  name = "codebuilder_lambda_policy"
  path = "/service-role/"
  policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Resource": [
        "${aws_codebuild_project.codebuilder.id}"
      ],
      "Action": [
        "codebuild:*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction"
      ],
      "Resource": "*"
    }
  ]
}
POLICY
}

resource "aws_iam_role_policy_attachment" "codebuilder_lambda_policy_attachment" {
  role = "${aws_iam_role.codebuilder_lambda_role.name}"
  policy_arn = "${aws_iam_policy.codebuilder_lambda_policy.arn}"
}

resource "aws_lambda_function" "codebuilder_lambda_function" {
  filename = "lambda.zip"
  function_name = "codebuilder"
  role = "${aws_iam_role.codebuilder_lambda_role.arn}"
  handler = "index.handler"
  description = "codebuilder step function lambda"
  runtime = "nodejs6.10"
  memory_size = 128
  timeout = 30
}

resource "aws_sfn_state_machine" "codebuilder_state_machine" {
  name     = "codebuilder_state_machine"
  role_arn = "${aws_iam_role.codebuilder_lambda_role.arn}"

  definition = <<EOF
  {
    "Comment": "codebuilder state machine",
    "StartAt": "start_build",
    "States": {
      "start_build": {
        "Type": "Task",
        "Resource": "${aws_lambda_function.codebuilder_lambda_function.arn}",
        "Next": "wait_for_build",
        "Catch": [
          {
            "ErrorEquals": [ "States.ALL" ],
            "Next": "catch_build"
          }
        ]
      },
      "wait_for_build": {
        "Type": "Task",
        "Resource": "${aws_lambda_function.codebuilder_lambda_function.arn}",
        "Next": "end_build",
        "Retry" : [
          {
            "ErrorEquals": [ "States.ALL" ],
            "IntervalSeconds": 20,
            "MaxAttempts": 45,
            "BackoffRate": 1
          }
        ],
        "Catch": [
          {
            "ErrorEquals": [ "States.ALL" ],
            "Next": "catch_build"
          }
        ]
      },
      "catch_build": {
        "Type": "Pass",
        "Result": "catch_build",
        "ResultPath": "$.step_name",
        "Next": "end_build"
      },
      "end_build": {
        "Type": "Task",
        "Resource": "${aws_lambda_function.codebuilder_lambda_function.arn}",
        "End": true
      }
    }
  }
EOF
}
