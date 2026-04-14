/**
 * Projects — the executive decision-support module.
 * Routes: /projects (dashboard) and /projects/:id (detail).
 */
import { useParams } from 'react-router-dom';
import ProjectsDashboard from '../components/Projects/ProjectsDashboard.jsx';
import ProjectDetail from '../components/Projects/ProjectDetail.jsx';

export default function Projects() {
  const { id } = useParams();
  return id ? <ProjectDetail projectId={id} /> : <ProjectsDashboard />;
}
