// @flow

// Flow types
import * as DataTypes from "./Data.flow";
import type Moment from "moment";

// Third party components
import React from "react";
import moment from "moment";

// Connector
import ErpNext from "./ErpNext";

export class ConnectorError extends Error {

  info: ?DataTypes.ErrorInfo;
  icon: string;
  intent: string;
  timeout: number;
  message: string;
  original: ?Error;

  constructor(message : string, info? : DataTypes.ErrorInfo, error? : Error) {
    super(message);
    this.info = info;
    this.icon = 'globe-network';
    this.intent = 'DANGER';
    this.timeout = 5000;
    // track inner errors that caused this one to happen
    if (error) {
      this.original = error;
      let message_lines = (this.message.match(/\n/g) || []).length + 1
      // append the initial error's stack to this one to get a complete picture
      this.stack = this.stack.split('\n').slice(0, message_lines + 1).join('\n') + '\n' +
        error.stack
    }
  }
}

export class LoginError extends ConnectorError { }
export class ReadError extends ConnectorError { }
export class UpdateError extends ConnectorError { }
export class CreateError extends ConnectorError { }
export class DeleteError extends ConnectorError { }
export class ConnectorNotReady extends ConnectorError { }
export class InvalidOperation extends ConnectorError { }

function bindCallbacks(obj : any, names : string[]) {
  let result : any = {}
  names.forEach(name => Reflect.set(result, name, Reflect.get(obj, name).bind(obj)));
  return result;
}

const context = React.createContext();

export class BackendProvider extends React.PureComponent<{}, DataTypes.State> {
  connector : DataTypes.ConnectorAPI;

  constructor(props : {}) {
    super(props);

    // TODO: Change the require() type of import to another connector in the future
    //       This just shows how easy it would be to replate the backend if necessary.
    this.connector = ErpNext;

    this.state = {
      loggedIn: false,
      attemptingLogin: false,
      auth: {
        usr: "",
        pwd: "",
        host: ""
      },
      user: {
        employee_name: ""
      },
      day: moment(),
      timeline: [],
      tasks: [],
      errors: [],
      activities: [],
      projects: [],
      actions: {
        ...bindCallbacks(this, [
          "throwError",
          "login",
          "listTasks",
          "startTask",
          "stopTask",
          "dismissError",
          "listDayTimeline",
          "updateActiveTimelineBlock",
          "updateTimelineBlock",
          "setCurrentDate",
          "newTask"
        ]),
      }
    }
  }

  dismissError(err : ConnectorError) {
    this.setState(prevState => {
      return {
        errors: prevState.errors.filter(e => e !== err)
      }
    });
  }

  throwError(err : ConnectorError, done? : (Error) => void) {
    console.error("ERROR IN BACKEND CALL: ", err);

    if ( "info" in err && err.info ) {
      if ( "server_messages" in err.info ) {
        err.info.server_messages.forEach(serr => console.error(serr));
      }

      if ( "remoteTrace" in err.info ) {
        err.info.remoteTrace.forEach(rt => console.error(rt.join("\n")));
      }
    }

    this.setState((prevState : DataTypes.State) => {
      return { errors: [...prevState.errors, err] };
    }, () => {
      console.log("Error set?", this.state.errors);
      if ( typeof done === "function" ) {
        done(err);
      }
    });
  }

  login(auth : DataTypes.Auth, done : DataTypes.ResultCallback) {

    this.setState({
      attemptingLogin: true,
      loggedIn: false,
    }, () => {
      this.connector.login(auth)
        .then(( user : DataTypes.User ) => {
          this.setState({
            attemptingLogin: false,
            loggedIn: true,
            auth,
            user
          }, () => done(user));
        })
        .catch(err => {
          this.setState({
            attemptingLogin: false,
            loggedIn: false,
            auth: {
              usr: "",
              pwd: "",
              host: ""
            }
          }, () =>
            this.throwError(
              err,
              () => done(false, err)
            )
          );
        });
      });
  }

  setCurrentDate( date : Moment ) : void {
    this.listDayTimeline(date)
  }

  listDayTimeline(date? : Moment) : Promise<void> {

    if ( !date ) {
      date = this.state.day;
    }

    return this.connector
      .listDayTimeline(date, this.state.tasks)
      .then((results : DataTypes.TimelineItem[]) => {
        this.setState({
          timeline: results,
          day: date
        })
        return;
      });
  }

  updateActiveTimelineBlock(block_id : string, time : Moment) : void {
    let timeline = this.state.timeline.slice(0);
    let block = timeline.find(b => b.id === block_id);
    if ( block ) {
      block.end = time;
      this.setState({
        timeline
      });
    }
  }

  updateTimelineBlock(item : DataTypes.TimelineItem) : void {
    let timeline = this.state.timeline.slice(0);
    let idx = timeline.findIndex(b => b.id === item.id);
    if ( idx > -1 ) {
      // update local data so our UI doesn't freeze while network request
      // happens.
      timeline.splice(idx, 1, item);
      console.log("Update timeblock: ")
      console.dir(item);
      this.setState({
        timeline
      });

      // We'll correct our data after our network request returns
      // even if the backend server returns the same data, its good practice
      // to allow our app to correct itself.
      this.connector.updateTimelineItem(item)
        .then((item) => {
          return this.listTasks();
        })
        .then(() => {
          return this.listDayTimeline();
        });
    }
  }

  newTask(task : DataTypes.Task) {
    return this.connector.newTask(task)
      .then(() => {
        return this.listTasks();
      })
      .catch(err => this.throwError(err));
  }

  listTasks() : Promise<void> {
    // always fetch list of available activities, just in case
    // we have new ones while app is running
    return Promise.all([
      this.connector.listProjects(),
      this.connector.listActivities(),
      this.connector.listTasks(this.state.user.employee_name)
    ])
    .then(results => {
      let projects = results[0];
      let activities = results[1];
      let tasks = results[2];
      this.setState({
        projects,
        activities,
        tasks
      });
      return;
    })
    .catch(err => this.throwError(err));
  }

  startTask(task : DataTypes.Task, activity : DataTypes.Activity) : Promise<any> {
    let timestamp = moment();
    return this.connector
      .startTask(task, activity, timestamp, this.state.user.employee_name)
      .then(() => {
        this.listTasks();
      })
      .catch(err => {
        this.throwError(err)
      });
  }

  stopTask(task : DataTypes.Task) : Promise<any> {
    let timestamp = moment();
    return this.connector
      .stopTask(task, timestamp, this.state.user.employee_name)
      .then(() => {
        this.listTasks();
      })
      .catch(err => {
        this.throwError(err)
      });
  }

  render() {
    return <context.Provider value={this.state} {...this.props} />;
  }
}

export const BackendConsumer = (props : any) => {
  return <context.Consumer {...props} />;
}
