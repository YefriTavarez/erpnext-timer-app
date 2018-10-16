// @flow

// Third party
import React from "react";
import { Card, Button, Tag, MenuItem, Spinner } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import moment from "moment";
import momentDurationFormatSetup from "moment-duration-format";
momentDurationFormatSetup(moment);

// Flow types
import type{ 
  TaskListState, TaskListProps,
  TaskListItemProps, TaskListItemState
} from "./Tasks.flow";
import * as DataTypes from "../connectors/Data.flow";
import type Moment from "moment";

// Components
import { BackendConsumer } from "../connectors/Data";
import { makeCancelable } from "../utils";

const ActivityPredicate = (query, activity) => {
  return activity.label.toLowerCase().indexOf(query.toLowerCase()) >= 0;
}

const ActivityRenderer = (activity, { handleClick, modifiers }) => {
  if (!modifiers.matchesPredicate) {
    return null;
  }

  return <MenuItem 
    key={activity.id}
    onClick={handleClick}
    text={activity.label}
  />
}

export class TaskListItem extends React.PureComponent<TaskListItemProps, TaskListItemState> {

  timerId : ?IntervalID;
  playPromise : ?any;

  constructor(props : TaskListItemProps) {
    super(props)

    this.state = {
      from_time: null,
      to_time: null,
      waiting: false
    }
    this.timerId = null; 
  }

  setupTimer() {
    this.timerId = setInterval(() => {
      this.setState({
        to_time: moment()
      })
    }, 1000);
  }

  stopTimer() {
    if ( this.timerId ) {
      clearInterval(this.timerId)
      this.timerId = null;
    }
  }

  onTimerStarted() {
    this.setState({
      from_time: moment(this.props.task.last_open_timestamp)
    })

    this.setupTimer();
  }

  componentDidMount() {
    if ( this.props.task.is_running && !this.timerId ) {
      this.onTimerStarted();
    } else if ( !this.props.task.is_running ) {
      this.stopTimer();
    }
  }

  componentDidUpdate() {
    if ( this.props.task.is_running && !this.timerId ) {
      this.onTimerStarted();
    } else if ( !this.props.task.is_running ) {
      this.stopTimer();
    }
  }

  componentWillUnmount() {
    if ( this.timerId ) {
      clearInterval(this.timerId);
    }

    if ( this.playPromise ) {
      this.playPromise.cancel();
    }
  }

  render() {
    const { onStartTask, onStopTask, task } = this.props;
    const tags = [];
    if ( task.tags ) {
      task.tags.forEach(tag => {
        tag = tag.trim();
        if ( tag.length > 0 ) {
          tags.push(<Tag key={tag} minimal>{tag}</Tag>);
        }
      })
    }
    const onPlayClick = (activity) => {
      this.setState({
        waiting: true,
      }, () => {
        this.playPromise = makeCancelable(onStartTask(task, activity, this.onTimerStarted));
        this.playPromise.promise
          .then(() => {
            this.setState({ waiting: false })
          })
          .catch(() => {
            // there should be no errors happening here
            // this promise is here to handle the spinner display
          });
      });
      
    }
    const onStopClick = () => {
      this.setState({
        waiting: true,
      }, () => {
        this.playPromise = makeCancelable(onStopTask(task));
        this.playPromise.promise
          .then(() => {
            this.setState({ waiting: false });
          })
          .catch(() => {
            // there should be no errors happening here
            // this promise is here to handle the spinner display
          })
      });
    }

    let total_ms = Math.floor((task.total_hours || 0) * 3600000);

    if ( task.is_running && this.state.to_time ) {
      total_ms += moment.duration(this.state.to_time.diff(this.state.from_time), "ms").asMilliseconds();
    }
    
    let total_time = moment.duration(total_ms, "ms").format()

    return <Card elevation={1} interactive className="task-list-item">
      <div className="related">
        <div className="project-name">{ task.project && ( <Button minimal small icon="git-branch" text={task.project} /> )}</div>
        <div className="parent">{ task.parent_label && ( <Button minimal small icon="bookmark" text={task.parent_label} /> )}</div>
      </div>
      <div className="task-content">
        <div className="task-info">
          <div className="subject">{task.label}</div>
          <div className="description">{(task.description || "").substring(0, 140)}</div>
          <div className="elapsed-time">Running Time: <span className="measure">{total_time}</span></div>
        </div>
        <div className="actions">
          { this.state.waiting && (
            <Spinner size="30" />
          ) }

          { !this.state.waiting && (
            <React.Fragment>
              { task.is_running && (
                <Button icon="stop" minimal large onClick={onStopClick} />
              ) }

              { !task.is_running && (
                <Select
                  resetOnClose
                  resetOnQuery 
                  resetOnSelect
                  items={this.props.activities || []}
                  itemPredicate={ActivityPredicate}
                  itemRenderer={ActivityRenderer}
                  noResults={<MenuItem disabled text="No Results." />}
                  onItemSelect={onPlayClick}
                >
                  <Button icon="play" minimal large />
                </Select>
              ) }
            </React.Fragment>
          ) }

        </div>
      </div>
      <div className="tags">
        { tags }
      </div>
    </Card>
  }
}

export class TaskList extends React.PureComponent<TaskListProps, TaskListState> {
  constructor(props : TaskListProps) {
    super(props);

    this.state = {
      tasks: []
    }
  }

  componentDidMount() {
    const { backend } = this.props;

    backend.actions.listTasks();
  }

  onStartTask(task : DataTypes.Task, activity : DataTypes.Activity) : Promise<any> {
    const { backend } = this.props;

    return backend.actions.startTask(task, activity).then(() => {
      this.props.nav("timesheet");
    })
  }

  onStopTask(task : DataTypes.Task) : Promise<any> {
    const { backend } = this.props;

    return backend.actions.stopTask(task);
  }

  render() {

    const onStartTask = (task : DataTypes.Task, activity : DataTypes.Activity) => {
      return this.onStartTask(task, activity);
    }
    const onStopTask = (task : DataTypes.Task) => {
      return this.onStopTask(task);
    }

    return <div className="page">
      <div className="page-title">Tasks</div>
      <div className="page-content">
        <div className="task-list">
          { this.props.backend.tasks.map(t => <TaskListItem 
              key={t.id} 
              task={t}
              activities={this.props.backend.activities || []}
              onStartTask={onStartTask}
              onStopTask={onStopTask}
            />) }
        </div>
      </div>
    </div>
  }
}

export function TaskPage(props : DataTypes.PageProps) {
  return <BackendConsumer>
    {backend => <TaskList backend={backend} {...props} />}
  </BackendConsumer>
}

export default TaskPage;