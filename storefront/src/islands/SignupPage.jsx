import { withIsland } from '../lib/island';
import GuestRoute from '../components/GuestRoute';
import Signup from '../screens/Signup';

export default withIsland(() => (
  <GuestRoute>
    <Signup />
  </GuestRoute>
));
